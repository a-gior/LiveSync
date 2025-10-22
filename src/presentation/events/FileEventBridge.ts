import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';

import { SyncStateManager } from '@app/SyncStateManager';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { absFs } from '@infra/helpers/path/PathJoin';
import { sha256OfFile } from '@infra/helpers/hash/FileHash';
import type { RemotePort } from '@app/ports/RemotePort';

import type {
  WorkspaceId,
  RelPath,
  NodeIndex,
} from '../../domain/types';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { compile, ignored } from '@infra/helpers/ignore/Ignore';
import { stringToRel, stringToWsId } from '@infra/helpers/path';
import { isDownloadable, isUploadable } from '@infra/helpers/diff';
import { parseActionPolicy } from '@infra/helpers/policy';
import { logExpectedError } from '@infra/helpers/logging';
import { FileOperationQueue } from '@infra/helpers/concurrency';

export class FileEventBridge {
  private readonly operationQueue = new FileOperationQueue();
  
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly remote: RemotePort,
    private readonly remoteCache: IndexCacheService
  ) {}

  register(disposables: vscode.Disposable[]): void {
    // VS Code-initiated file ops
    disposables.push(vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)));
    disposables.push(vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)));
    disposables.push(vscode.workspace.onDidRenameFiles((e) => this.onRename(e)));
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));

    // External changes (terminal/git/OS): we watch all folders
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
      watcher.onDidCreate((uri) => this.onExternalCreate(uri));
      watcher.onDidChange((uri) => this.onExternalChange(uri));
      watcher.onDidDelete((uri) => this.onExternalDelete(uri));
      disposables.push(watcher);
    }

    // Open happens per document (no need to duplicate per folder)
    disposables.push(vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d)));

    disposables.push({
      dispose: () => {
        this.operationQueue.clear();
      }
    });
  }

  // ====================================================================================
  // Handlers for VS Code events
  // ====================================================================================

  private async onSave(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) {return;}

    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {return;}

    const workspaceId = stringToWsId(folder.uri.fsPath);
    const relPath = this.relativeOf(workspaceId, doc.uri.fsPath);

    // Queue key includes workspace to allow parallel ops across workspaces
    const queueKey = `${workspaceId}:${relPath}`;

    await this.operationQueue.enqueue(queueKey, async () => {
      // 1) Update local snapshot with new file hash
      try {
        const hash = await sha256OfFile(doc.uri.fsPath);
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'file', hash },
        });
      } catch (err) {
        logExpectedError(`FileEventBridge:onSave:hash:${relPath}`, err);
        return; // Don't proceed if we can't hash
      }

      // 2) Apply policy for save
      const eff = await this.config.getById(workspaceId);
      const rules = compile(eff.ignoreGlobs);
      if (ignored(relPath, rules)) return;

      const policy = parseActionPolicy(eff.data.actionOnSave);
      await this.maybeActByPolicy(workspaceId, relPath, policy, 'save');
    });
  }

  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    // Process in parallel across different files, but serialize same file
    await Promise.all(e.files.map(uri => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return Promise.resolve();

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const relPath = this.relativeOf(workspaceId, uri.fsPath);
      const queueKey = `${workspaceId}:${relPath}`;

      return this.operationQueue.enqueue(queueKey, async () => {
        // Determine if the created target is a file or a folder
        let isDir = false;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          isDir = (stat.type & vscode.FileType.Directory) !== 0;
        } catch (err) {
          logExpectedError(`FileEventBridge:onCreate:stat:${relPath}`, err);
          return;
        }

        // Update local snapshot
        if (isDir) {
          this.state.applyLocal({
            workspaceId,
            type: 'modify',
            path: relPath,
            meta: { type: 'folder', hash: '' },
          });
        } else {
          try {
            const hash = await sha256OfFile(uri.fsPath);
            this.state.applyLocal({
              workspaceId,
              type: 'modify',
              path: relPath,
              meta: { type: 'file', hash },
            });
          } catch (err) {
            logExpectedError(`FileEventBridge:onCreate:hash:${relPath}`, err);
            return;
          }
        }

        // Policy on create
        const eff = await this.config.getById(workspaceId);
        const rules = compile(eff.ignoreGlobs);
        if (ignored(relPath, rules)) return;

        const policy = parseActionPolicy(eff.data.actionOnCreate);
        await this.maybeActByPolicy(workspaceId, relPath, policy, 'create');
      });
    }));
  }

  private async onDelete(event: vscode.FileDeleteEvent): Promise<void> {
    await Promise.all(event.files.map(uri => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return Promise.resolve();

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const relPath = this.relativeOf(workspaceId, uri.fsPath);
      const queueKey = `${workspaceId}:${relPath}`;

      return this.operationQueue.enqueue(queueKey, async () => {
        // Update local index: remove file or entire subtree
        const hadLocalChildren = this.state.hasLocalChildren(workspaceId, relPath);
        if (hadLocalChildren) {
          this.state.removeLocalSubtree(workspaceId, relPath);
        } else {
          this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
        }

        // Policy on delete
        const eff = await this.config.getById(workspaceId);
        const rules = compile(eff.ignoreGlobs);
        if (ignored(relPath, rules)) return;

        const policy = parseActionPolicy(eff.data.actionOnDelete);

        // A) check-only → informational popup
        if (policy.check && !policy.direction && policy.extras.size === 0) {
          await this.showCheckInfo('delete', relPath);
          return;
        }

        // B) contains 'delete' → delete on remote
        if (policy.extras.has('delete')) {
          if (policy.check) {
            const decision = await this.confirmPolicyAction(workspaceId, 'delete', false, relPath);
            if (decision !== 'proceed') return;
          }

          try {
            await this.remote.deletePath(workspaceId, relPath);
            this.state.applyRemote({
              workspaceId,
              type: 'delete',
              path: relPath
            });
          } catch (err) {
            logExpectedError(`FileEventBridge:onDelete:remote:${relPath}`, err);
          }
          return;
        }

        // C) direction === 'download' → restore from remote
        if (policy.direction === 'download') {
          if (policy.check) {
            const decision = await this.confirmPolicyAction(workspaceId, 'download', false, relPath);
            if (decision !== 'proceed') return;
          }

          try {
            const restored = await this.restoreRemoteSubtree(workspaceId, relPath);
            if (restored === 0) {
              const absLocal = absFs(workspaceId, relPath);
              await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(absLocal)));
              await this.remote.downloadFile(workspaceId, relPath, absLocal);
              const hash = await sha256OfFile(absLocal);
              this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
            }
          } catch (err) {
            logExpectedError(`FileEventBridge:onDelete:restore:${relPath}`, err);
          }
        }
      });
    }));
  }

  private async onRename(event: vscode.FileRenameEvent): Promise<void> {
    await Promise.all(event.files.map(({ oldUri, newUri }) => {
      const folder = vscode.workspace.getWorkspaceFolder(newUri) ?? vscode.workspace.getWorkspaceFolder(oldUri);
      if (!folder) return Promise.resolve();

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const oldRel = this.relativeOf(workspaceId, oldUri.fsPath);
      const newRel = this.relativeOf(workspaceId, newUri.fsPath);
      
      const queueKey = `${workspaceId}:${oldUri}`;

      return this.operationQueue.enqueue(queueKey, async () => {

        // Local snapshot: remove old path (file or subtree), then add new (if file)
        this.state.applyLocal({ workspaceId, type: 'delete', path: oldRel });

        let newIsDir = false;
        try {
          const stat = await vscode.workspace.fs.stat(newUri);
          newIsDir = (stat.type & vscode.FileType.Directory) !== 0;

          if (!newIsDir) {
            const hash = await sha256OfFile(newUri.fsPath);
            this.state.applyLocal({
              workspaceId,
              type: 'modify',
              path: newRel,
              meta: { type: 'file', hash },
            });
          } else {
            // Create folder node; its hash will settle via recompute
            this.state.applyLocal({
              workspaceId,
              type: 'modify',
              path: newRel,
              meta: { type: 'folder', hash: '' },
            });
          }
        } catch {
          // If stat fails, we still removed oldRel, and recompute will reflect downstream events.
        }

        const eff = await this.config.getById(workspaceId);
      
        const rules = compile(eff.ignoreGlobs);
        if (ignored(oldRel, rules)) { return; }
        const policy = parseActionPolicy(eff.data.actionOnMove);

        // A) check-only (no 'rename' extra) → info and done
        if (policy.check && !policy.direction && !policy.extras.has('rename')) {
          await this.showCheckInfo('rename', newRel, oldRel);
          return;
        }

        // B) extras.has('rename') → remote semantics = delete old + upload new (file or subtree)
        if (policy.extras.has('rename')) {
          if (policy.check) {
            const decision = await this.confirmPolicyAction(workspaceId, 'move', false, newRel, oldRel);
            if (decision !== 'proceed') {return;}
          }

          await this.remote.deletePath(workspaceId, oldRel).catch((err) => {
            logExpectedError(`FileEventBridge:deleteOldPath:${oldRel}`, err);
          });

          if (!newIsDir) {
            const absLocal = absFs(workspaceId, newRel);
            await this.remote.uploadFile(workspaceId, newRel, absLocal);
            // Update remote snapshot optimistically
            const hash = await sha256OfFile(absLocal).catch(() => undefined);
            if (hash) {
              this.state.applyRemote({
                workspaceId,
                type: 'modify',
                path: newRel,
                meta: { type: 'file', hash }
              });
            }
            
            this.state.applyRemote({
              workspaceId,
              type: 'delete',
              path: oldRel
            });
          } else {
            // Upload folder subtree
            const localIndex = this.state.getLocalIndex(workspaceId);
            const prefix = stringToRel((newRel as string).replace(/\\/g, '/').replace(/\/+$/, '') + '/');

            for (const [rel, meta] of localIndex) {
              const s = rel as string;
              if (rel === newRel || s.startsWith(prefix)) {
                if (meta.type === 'file') {
                  const absLocal = absFs(workspaceId, rel);
                  await this.remote.uploadFile(workspaceId, rel, absLocal);
                  const h = await sha256OfFile(absLocal).catch(() => undefined);
                  if (h) {
                    this.state.applyRemote({
                      workspaceId,
                      type: 'modify',
                      path: rel,
                      meta: { type: 'file', hash: h }
                    });
                  }
                } else {
                  // ensure folder nodes exist remotely as we go
                  this.state.applyRemote({
                    workspaceId,
                    type: 'modify',
                    path: rel,
                    meta: { type: 'folder', hash: '' }
                  });
                  
                }
              }
            }
            
            this.state.applyRemote({
              workspaceId,
              type: 'delete',
              path: oldRel
            });
          }
          return;
        }

        // C) direction === 'upload' → ensure the NEW path exists on remote
        if (policy.direction === 'upload') {
          if (policy.check) {
            const decision = await this.confirmPolicyAction( workspaceId, 'upload', /*allowDiff*/ !newIsDir, newRel);
            if (decision !== 'proceed') {return;}
          }

          if (!newIsDir) {
            const absLocal = absFs(workspaceId, newRel);
            await this.remote.uploadFile(workspaceId, newRel, absLocal);
            const h = await sha256OfFile(absLocal).catch(() => undefined);
            if (h) {
              this.state.applyRemote({
                workspaceId,
                type: 'modify',
                path: newRel,
                meta: { type: 'file', hash: h }
              });
            }
          } else {
            // Upload folder subtree
            const localIndex = this.state.getLocalIndex(workspaceId);
            const prefix = stringToRel((newRel as string).replace(/\\/g, '/').replace(/\/+$/, '') + '/');
            for (const [rel, meta] of localIndex) {
              const s = rel as string;
              if (rel === newRel || s.startsWith(prefix)) {
                if (meta.type === 'file') {
                  const absLocal = absFs(workspaceId, rel);
                  await this.remote.uploadFile(workspaceId, rel, absLocal);
                  const h = await sha256OfFile(absLocal).catch(() => undefined);
                  if (h) {
                    this.state.applyRemote({
                      workspaceId,
                      type: 'modify',
                      path: rel,
                      meta: { type: 'file', hash: h }
                    });
                  }
                } else {
                  this.state.applyRemote({
                    workspaceId,
                    type: 'modify',
                    path: rel,
                    meta: { type: 'folder', hash: '' }
                  });
                }
              }
            }
          }
          return;
        }

        // D) direction === 'download' → restore the NEW path from remote
        if (policy.direction === 'download') {
          if (policy.check) {
            const decision = await this.confirmPolicyAction(workspaceId, 'download', false, newRel);
            if (decision !== 'proceed') {return;}
          }

          const restored = await this.restoreRemoteSubtree(workspaceId, newRel);
          if (restored === 0) {
            // Try exact file
            const absLocal = absFs(workspaceId, newRel);
            await this.remote.downloadFile(workspaceId, newRel, absLocal).catch(() => undefined);
            const h = await sha256OfFile(absLocal).catch(() => undefined);
            if (h) {
              this.state.applyLocal({ workspaceId, type: 'modify', path: newRel, meta: { type: 'file', hash: h } });
            }
          }
          return;
        }

        // E) no policy → do nothing remotely; diff will reflect the mismatch
      });
    }));
  }

  private async onOpen(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) {return;}

    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {return;}

    const workspaceId = stringToWsId(folder.uri.fsPath);
    const relPath = this.relativeOf(workspaceId, doc.uri.fsPath);

    const queueKey = `${workspaceId}:${relPath}`;

    await this.operationQueue.enqueue(queueKey, async () => {
      const eff = await this.config.getById(workspaceId);
    
      const rules = compile(eff.ignoreGlobs);
      if (ignored(relPath, rules)) { return; }

      const policy = parseActionPolicy(eff.data.actionOnOpen);

      // check-only → info
      if (policy.check && !policy.direction && policy.extras.size === 0) {
        await this.showCheckInfo('open', relPath);
        return;
      }

      if (policy.direction === 'download') {
        const entry = this.state.getDiffEntry(workspaceId, relPath);
        const allowed = entry ? isDownloadable(entry.status) : true;
        if (!allowed) {return;}

        if (policy.check) {
          const decision = await this.confirmPolicyAction(workspaceId, 'download', false, relPath);
          if (decision !== 'proceed') {return;}
        }

        const abs = absFs(workspaceId, relPath);
        await this.remote.downloadFile(workspaceId, relPath, abs);
        const hash = await sha256OfFile(abs);
        this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
      }
    });
  }

  // ====================================================================================
  // External watchers: mutate local snapshot only (avoid loops)
  // ====================================================================================

  private async onExternalCreate(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {return;}

    const workspaceId = stringToWsId(folder.uri.fsPath);
    const rel = this.relativeOf(workspaceId, uri.fsPath);

    // Probe kind; treat folders as folder nodes to ensure they show up/fold properly
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const isDir = (stat.type & vscode.FileType.Directory) !== 0;

      if (isDir) {
        this.state.applyLocal({ workspaceId, type: 'modify', path: rel, meta: { type: 'folder', hash: '' } });
      } else {
        const hash = await sha256OfFile(uri.fsPath);
        this.state.applyLocal({ workspaceId, type: 'modify', path: rel, meta: { type: 'file', hash } });
      }
    } catch {
      // If stat/hash fails, ignore; next scan will reconcile
    }
  }

  private async onExternalChange(uri: vscode.Uri): Promise<void> {
    // Same as create for files: recompute hash and mark modified
    await this.onExternalCreate(uri);
  }

  private async onExternalDelete(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {return;}

    const workspaceId = stringToWsId(folder.uri.fsPath);
    const relPath = this.relativeOf(workspaceId, uri.fsPath);

    const hasChildren = this.state.hasLocalChildren(workspaceId, relPath);
    if (hasChildren) {
      this.state.removeLocalSubtree(workspaceId, relPath);
    } else {
      this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
    }
  }

  // ====================================================================================
  // Core restoring logic (download subtree from remote to local)
  // ====================================================================================

  /**
   * Restore a folder (and its descendants) from remote to local.
   * Returns the number of files restored.
   * - Uses remote.list(workspace) once and downloads only file nodes under the prefix.
   * - Updates *local* snapshot only; the remote snapshot is already authoritative.
   */
  private async restoreRemoteSubtree(workspaceId: WorkspaceId, folderRel: RelPath): Promise<number> {
    const remoteIndex: NodeIndex = await this.remote.list(workspaceId);
    await this.remoteCache.save(workspaceId, remoteIndex);

    const normalized = (folderRel as string).replace(/\\/g, '/').replace(/\/+$/, '');
    const prefix = normalized ? normalized + '/' : '';
    const targets: RelPath[] = [];

    const exact = remoteIndex.get(stringToRel(normalized));
    if (exact?.type === 'file') {
      targets.push(stringToRel(normalized));
    } else {
      for (const [rel, meta] of remoteIndex) {
        const s = rel as string;
        if (rel === stringToRel(normalized) || (prefix && s.startsWith(prefix))) {
          if (meta.type === 'file') {targets.push(rel);}
          // For folders: we’ll ensure directories exist locally before downloading files
        }
      }
    }

    if (targets.length === 0) {return 0;}

    let restored = 0;
    for (const rel of targets) {
      const absLocal = absFs(workspaceId, rel);
      await fsp.mkdir(path.dirname(absLocal), { recursive: true });
      await this.remote.downloadFile(workspaceId, rel, absLocal);
      const hash = await sha256OfFile(absLocal);
      this.state.applyLocal({ workspaceId, type: 'modify', path: rel, meta: { type: 'file', hash } });
      restored += 1;
    }
    return restored;
  }

  // ====================================================================================
  // Policy application (shared)
  // ====================================================================================

  /**
   * Check if we should prompt the user based on the policy check.
   * Returns true only if the check condition is negative (conflict detected).
   */
  private async checkShouldPrompt(
    workspaceId: WorkspaceId,
    relPath: RelPath,
    hint: 'save' | 'create' | 'open' | 'delete' | 'move' | 'upload' | 'download'
  ): Promise<{ shouldPrompt: boolean; reason?: string }> {
    const localMeta = this.state.getLocalMeta(workspaceId, relPath);
    const remoteMeta = this.state.getRemoteMeta(workspaceId, relPath);

    switch (hint) {
      case 'save':
      case 'open':
      case 'upload': {
        // Check: Has the remote file been modified by someone else?
        // We compare our KNOWN remote hash (from state) with the ACTUAL remote hash
        if (!remoteMeta) {
          return { shouldPrompt: false }; // No remote file, no conflict
        }
        
        if (remoteMeta.type !== 'file' || !remoteMeta.hash) {
          return { shouldPrompt: false };
        }

        // Fetch the ACTUAL current remote hash
        let actualRemoteHash: string;
        try {
          const remoteIndex = await this.remote.list(workspaceId);
          const actualMeta = remoteIndex.get(relPath);
          if (!actualMeta || actualMeta.type !== 'file') {
            return { shouldPrompt: false }; // Remote file disappeared
          }
          actualRemoteHash = actualMeta.hash;
        } catch (err) {
          // Can't check remote, assume no conflict
          return { shouldPrompt: false };
        }

        // Compare: known vs actual
        const remoteWasModified = remoteMeta.hash !== actualRemoteHash;
        
        return {
          shouldPrompt: remoteWasModified,
          reason: remoteWasModified 
            ? `Remote file was modified by someone else (expected: ${remoteMeta.hash.slice(0, 8)}..., actual: ${actualRemoteHash.slice(0, 8)}...)` 
            : undefined
        };
      }

      case 'create':
      case 'move': {
        // Check: Does file already exist remotely?
        if (!remoteMeta) {
          return { shouldPrompt: false }; // Doesn't exist, OK to create
        }
        
        return {
          shouldPrompt: true,
          reason: `File already exists remotely`
        };
      }

      case 'delete': {
        // Check: Has someone modified the remote file before we delete it?
        if (!remoteMeta || remoteMeta.type !== 'file') {
          return { shouldPrompt: false }; // Nothing to delete or not a file
        }

        // Fetch actual remote hash
        let actualRemoteHash: string;
        try {
          const remoteIndex = await this.remote.list(workspaceId);
          const actualMeta = remoteIndex.get(relPath);
          if (!actualMeta || actualMeta.type !== 'file') {
            return { shouldPrompt: false }; // Already deleted
          }
          actualRemoteHash = actualMeta.hash;
        } catch (err) {
          return { shouldPrompt: false };
        }

        const remoteWasModified = remoteMeta.hash !== actualRemoteHash;
        
        return {
          shouldPrompt: remoteWasModified,
          reason: remoteWasModified 
            ? 'Remote file was modified before deletion' 
            : undefined
        };
      }

      case 'download': {
        // Check: Is local file different from what we're about to download?
        if (!localMeta || !remoteMeta) {
          return { shouldPrompt: false }; // One side missing
        }
        
        if (localMeta.type !== 'file' || remoteMeta.type !== 'file') {
          return { shouldPrompt: false };
        }

        // Local differs from remote
        const localDifferent = localMeta.hash !== remoteMeta.hash;
        
        return {
          shouldPrompt: localDifferent,
          reason: localDifferent 
            ? `Local file differs from remote (will be overwritten)` 
            : undefined
        };
      }

      default:
        return { shouldPrompt: false };
    }
  }

  // Replace the entire maybeActByPolicy method
  private async maybeActByPolicy(
    workspaceId: WorkspaceId,
    relPath: RelPath,
    policy: ReturnType<typeof parseActionPolicy>,
    hint: 'save' | 'create' | 'open' | 'delete' | 'move' | 'upload' | 'download'
  ): Promise<void> {
    // No direction and no extras → nothing to do
    if (!policy.direction && policy.extras.size === 0) {
      if (policy.check) {
        // Check-only: show info if check is negative
        const { shouldPrompt, reason } = await this.checkShouldPrompt(workspaceId, relPath, hint);
        if (shouldPrompt) {
          await vscode.window.showInformationMessage(
            `LiveSync (check): ${reason || 'Check failed'} for "${relPath as string}". No sync action taken.`
          );
        }
      }
      return;
    }

    // Has a direction (upload/download) or extras (delete/rename)
    if (policy.direction) {
      const entry = this.state.getDiffEntry(workspaceId, relPath);
      const allowed = policy.direction === 'upload'
        ? (entry ? isUploadable(entry.status) : true)
        : (entry ? isDownloadable(entry.status) : true);

      if (!allowed) {
        return; // Status doesn't allow this action
      }

      // If check is enabled, verify condition
      if (policy.check) {
        const { shouldPrompt, reason } = await this.checkShouldPrompt(
          workspaceId, 
          relPath, 
          policy.direction === 'upload' ? hint : 'download'
        );
        
        if (shouldPrompt) {
          // Prompt user to confirm action
          const decision = await this.confirmPolicyAction(
            workspaceId, 
            policy.direction, 
            policy.direction === 'upload' && (hint === 'save' || hint === 'create'), // allowDiff
            relPath,
            undefined,
            reason
          );
          if (decision !== 'proceed') {
            return; // User cancelled
          }
        }
        // If check passed (shouldPrompt = false), proceed silently
      }

      // Perform the action
      if (policy.direction === 'upload') {
        const abs = absFs(workspaceId, relPath);
        await this.remote.uploadFile(workspaceId, relPath, abs);
        const h = await sha256OfFile(abs).catch(() => undefined);
        if (h) {
          this.state.applyRemote({
            workspaceId,
            type: 'modify',
            path: relPath,
            meta: { type: 'file', hash: h }
          });
        }
      } else {
        const abs = absFs(workspaceId, relPath);
        await this.remote.downloadFile(workspaceId, relPath, abs);
        const h = await sha256OfFile(abs).catch(() => undefined);
        if (h) {
          this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash: h } });
        }
      }
    }

    // Extras are handled in specific event handlers (delete/rename)
  }

  // Update confirmPolicyAction to remove duplicate Cancel and add reason
  private async confirmPolicyAction(
    workspaceId: WorkspaceId,
    mode: 'upload' | 'download' | 'delete' | 'move',
    allowDiff: boolean,
    relPath: RelPath,
    oldPath?: RelPath,
    reason?: string
  ): Promise<'proceed' | 'diff' | 'cancel'> {
    const label =
      mode === 'upload'   ? 'Upload' :
      mode === 'download' ? 'Download' :
      mode === 'delete'   ? 'Delete from Remote' : 'Move on Remote';

    const reasonText = reason ? `\n\n${reason}` : '';
    const message = `LiveSync: ${label} "${(relPath as string) || '.'}"?${reasonText}`;
    
    // Build buttons array based on allowDiff
    const buttons = allowDiff 
      ? (['Proceed', 'Show Diff', 'Cancel'] as const)
      : (['Proceed', 'Cancel'] as const);

    const choice = await vscode.window.showWarningMessage(
      message, 
      { modal: true }, 
      ...buttons
    );

    if (choice === 'Proceed') {
      return 'proceed';
    }
    
    if (choice === 'Show Diff' && allowDiff) {
      await vscode.commands.executeCommand('livesync.experimental.node.showDiff', {
        kind: 'entry',
        workspaceId,
        path: relPath,
      });

      const display = oldPath ? `${oldPath} → ${relPath}` : relPath;
      const again = await vscode.window.showInformationMessage(
        `Proceed to ${label.toLowerCase()} "${display}"?`,
        { modal: true },
        'Proceed',
        'Cancel'
      );
      return again === 'Proceed' ? 'proceed' : 'cancel';
    }
    
    return 'cancel';
  }

  // ====================================================================================
  // UI helpers (prompts / formatting)
  // ====================================================================================

  private relativeOf(workspaceId: WorkspaceId, absFsPath: string): RelPath {
    const normRoot = (workspaceId as string).replace(/\\/g, '/').replace(/\/+$/, '');
    const normAbs = absFsPath.replace(/\\/g, '/');
    return stringToRel(normAbs.startsWith(normRoot + '/') ? normAbs.slice(normRoot.length + 1) : '');
  }

  private async showCheckInfo(
    hint: 'save' | 'create' | 'open' | 'rename' | 'delete',
    relPath: RelPath,
    oldPath?: RelPath
  ): Promise<void> {
    const verb =
      hint === 'save'   ? 'Saved' :
      hint === 'create' ? 'Created' :
      hint === 'open'   ? 'Opened' :
      hint === 'rename' ? 'Renamed' : 'Deleted';

      const display = oldPath ? `${oldPath} → ${relPath}` : relPath;

    const message = `LiveSync (check): ${verb} “${display}”. No sync action taken (policy = check).`;
    await vscode.window.showInformationMessage(message);
  }
}
