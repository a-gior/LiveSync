import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';

import { SyncStateManager } from '@app/SyncStateManager';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { absFs } from '@infra/helpers/path/PathJoin';
import { sha1OfFile } from '@infra/helpers/hash/FileHash';
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
import { logExpectedError } from '../../infrastructure/helpers/logging';

export class FileEventBridge {
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

    // 1) Update local snapshot with new file hash (NodeIndex contains files & folders)
    try {
      const hash = await sha1OfFile(doc.uri.fsPath);
      this.state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash },
      });
    } catch(err) {
      // ignore hashing errors (file may be transiently locked)
      logExpectedError(`FileEventBridge:hashFile:${doc.uri.fsPath}`, err);
    }

    // 2) Apply policy for save (e.g., "check&save" → prompt + upload)
    const eff = await this.config.getById(workspaceId);

    const rules = compile(eff.ignoreGlobs);
    if (ignored(relPath, rules)) { return; }

    const policy = parseActionPolicy(eff.data.actionOnSave);
    await this.maybeActByPolicy(workspaceId, relPath, policy, 'save');
  }

  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    for (const uri of e.files) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) {continue;}

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const relPath = this.relativeOf(workspaceId, uri.fsPath);

      // Determine if the created target is a file or a folder
      let isDir = false;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        isDir = (stat.type & vscode.FileType.Directory) !== 0;
      } catch {
        // best effort; if stat fails, we'll try hashing as file
      }

      // Update local snapshot:
      if (isDir) {
        // Create a folder node; folder hash will be recomputed during recompute()
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'folder', hash: '' },
        });
      } else {
        try {
          const hash = await sha1OfFile(uri.fsPath);
          this.state.applyLocal({
            workspaceId,
            type: 'modify',
            path: relPath,
            meta: { type: 'file', hash },
          });
        } catch {
          // ignore (temporary files etc.)
        }
      }

      // Policy on create
      const eff = await this.config.getById(workspaceId);
    
      const rules = compile(eff.ignoreGlobs);
      if (ignored(relPath, rules)) { return; }

      const policy = parseActionPolicy(eff.data.actionOnCreate);
      await this.maybeActByPolicy(workspaceId, relPath, policy, 'create');
    }
  }

  private async onDelete(event: vscode.FileDeleteEvent): Promise<void> {
    for (const uri of event.files) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) {continue;}

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const relPath = this.relativeOf(workspaceId, uri.fsPath);

      // Update local index: remove file or entire subtree
      const hadLocalChildren = this.state.hasLocalChildren(workspaceId, relPath);
      if (hadLocalChildren) {
        this.state.removeLocalSubtree(workspaceId, relPath);
      } else {
        this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
      }

      // Policy on delete (check-only, delete remote, or restore from remote)
      const eff = await this.config.getById(workspaceId);
    
      const rules = compile(eff.ignoreGlobs);
      if (ignored(relPath, rules)) { return; }

      const policy = parseActionPolicy(eff.data.actionOnDelete);

      // A) check-only → informational popup
      if (policy.check && !policy.direction && policy.extras.size === 0) {
        await this.showCheckInfo('delete', relPath);
        continue;
      }

      // B) contains 'delete' → delete on remote (recursive for folders)
      if (policy.extras.has('delete')) {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(workspaceId, 'delete', /*allowDiff*/ false, relPath);
          if (decision !== 'proceed') {continue;}
        }

        await this.remote.deletePath(workspaceId, relPath);
        // Optimistic remote snapshot update (no full rescan)
        this.state.removeRemoteSubtree(workspaceId, relPath, /*includeRoot*/ true);
        continue;
      }

      // C) direction === 'download' → restore from remote (file or subtree)
      if (policy.direction === 'download') {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(workspaceId, 'download', /*allowDiff*/ false, relPath);
          if (decision !== 'proceed') {continue;}
        }

        const restored = await this.restoreRemoteSubtree(workspaceId, relPath);
        if (restored === 0) {
          // Try exact-file restore as a last attempt
          const absLocal = absFs(workspaceId, relPath);
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(absLocal)));
          await this.remote.downloadFile(workspaceId, relPath, absLocal).catch(() => undefined);
          try {
            const hash = await sha1OfFile(absLocal);
            this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
          } catch { /* ignore */ }
        }
        continue;
      }

      // D) none → leave as a remote-only diff
    }
  }

  private async onRename(event: vscode.FileRenameEvent): Promise<void> {
    for (const { oldUri, newUri } of event.files) {
      const folder = vscode.workspace.getWorkspaceFolder(newUri) ?? vscode.workspace.getWorkspaceFolder(oldUri);
      if (!folder) {continue;}

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const oldRel = this.relativeOf(workspaceId, oldUri.fsPath);
      const newRel = this.relativeOf(workspaceId, newUri.fsPath);

      // Local snapshot: remove old path (file or subtree), then add new (if file)
      this.state.applyLocal({ workspaceId, type: 'delete', path: oldRel });

      let newIsDir = false;
      try {
        const stat = await vscode.workspace.fs.stat(newUri);
        newIsDir = (stat.type & vscode.FileType.Directory) !== 0;

        if (!newIsDir) {
          const hash = await sha1OfFile(newUri.fsPath);
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
        continue;
      }

      // B) extras.has('rename') → remote semantics = delete old + upload new (file or subtree)
      if (policy.extras.has('rename')) {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(workspaceId, 'move', false, newRel, oldRel);
          if (decision !== 'proceed') {continue;}
        }

        await this.remote.deletePath(workspaceId, oldRel).catch((err) => {
          logExpectedError(`FileEventBridge:deleteOldPath:${oldRel}`, err);
        });

        if (!newIsDir) {
          const absLocal = absFs(workspaceId, newRel);
          await this.remote.uploadFile(workspaceId, newRel, absLocal);
          // Update remote snapshot optimistically
          const hash = await sha1OfFile(absLocal).catch(() => undefined);
          if (hash) {
            this.state.upsertRemoteNode(workspaceId, newRel, { type: 'file', hash });
          }
          this.state.removeRemoteSubtree(workspaceId, oldRel, /*includeRoot*/ true);
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
                const h = await sha1OfFile(absLocal).catch(() => undefined);
                if (h) {this.state.upsertRemoteNode(workspaceId, rel, { type: 'file', hash: h });}
              } else {
                // ensure folder nodes exist remotely as we go
                this.state.upsertRemoteNode(workspaceId, rel, { type: 'folder', hash: '' });
              }
            }
          }
          this.state.removeRemoteSubtree(workspaceId, oldRel, /*includeRoot*/ true);
        }
        continue;
      }

      // C) direction === 'upload' → ensure the NEW path exists on remote
      if (policy.direction === 'upload') {
        if (policy.check) {
          const decision = await this.confirmPolicyAction( workspaceId, 'upload', /*allowDiff*/ !newIsDir, newRel);
          if (decision !== 'proceed') {continue;}
        }

        if (!newIsDir) {
          const absLocal = absFs(workspaceId, newRel);
          await this.remote.uploadFile(workspaceId, newRel, absLocal);
          const h = await sha1OfFile(absLocal).catch(() => undefined);
          if (h) {
            this.state.upsertRemoteNode(workspaceId, newRel, { type: 'file', hash: h });
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
                const h = await sha1OfFile(absLocal).catch(() => undefined);
                if (h) {
                  this.state.upsertRemoteNode(workspaceId, rel, { type: 'file', hash: h });
                }
              } else {
                this.state.upsertRemoteNode(workspaceId, rel, { type: 'folder', hash: '' });
              }
            }
          }
        }
        continue;
      }

      // D) direction === 'download' → restore the NEW path from remote
      if (policy.direction === 'download') {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(workspaceId, 'download', false, newRel);
          if (decision !== 'proceed') {continue;}
        }

        const restored = await this.restoreRemoteSubtree(workspaceId, newRel);
        if (restored === 0) {
          // Try exact file
          const absLocal = absFs(workspaceId, newRel);
          await this.remote.downloadFile(workspaceId, newRel, absLocal).catch(() => undefined);
          const h = await sha1OfFile(absLocal).catch(() => undefined);
          if (h) {
            this.state.applyLocal({ workspaceId, type: 'modify', path: newRel, meta: { type: 'file', hash: h } });
          }
        }
        continue;
      }

      // E) no policy → do nothing remotely; diff will reflect the mismatch
    }
  }

  private async onOpen(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) {return;}

    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {return;}

    const workspaceId = stringToWsId(folder.uri.fsPath);
    const relPath = this.relativeOf(workspaceId, doc.uri.fsPath);

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
      const hash = await sha1OfFile(abs);
      this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
    }
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
        const hash = await sha1OfFile(uri.fsPath);
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
      const hash = await sha1OfFile(absLocal);
      this.state.applyLocal({ workspaceId, type: 'modify', path: rel, meta: { type: 'file', hash } });
      restored += 1;
    }
    return restored;
  }

  // ====================================================================================
  // Policy application (shared)
  // ====================================================================================

  private async maybeActByPolicy(
    workspaceId: WorkspaceId,
    relPath: RelPath,
    policy: ReturnType<typeof parseActionPolicy>,
    hint: 'save' | 'create' | 'open' | 'rename' | 'delete'
  ): Promise<void> {
    // A) check-only → info popup, no action
    if (policy.check && !policy.direction && policy.extras.size === 0) {
      await this.showCheckInfo(hint, relPath);
      return;
    }

    // B) direction-only (upload/download), optionally with check
    if (policy.direction) {
      const entry = this.state.getDiffEntry(workspaceId, relPath);
      const allowed = policy.direction === 'upload'
        ? (entry ? isUploadable(entry.status) : true)
        : (entry ? isDownloadable(entry.status) : true);

      if (!allowed) {return;}

      if (policy.check) {
        const allowDiff =
          policy.direction === 'upload' && (hint === 'save' || hint === 'create' || hint === 'rename');
        const decision = await this.confirmPolicyAction(workspaceId, policy.direction, allowDiff, relPath);
        if (decision !== 'proceed') {return;}
      }

      if (policy.direction === 'upload') {
        const abs = absFs(workspaceId, relPath);
        await this.remote.uploadFile(workspaceId, relPath, abs);
        // Optimistically update the remote snapshot with the local file hash
        const h = await sha1OfFile(abs).catch(() => undefined);
        if (h) {this.state.upsertRemoteNode(workspaceId, relPath, { type: 'file', hash: h });}
        return;
      } else {
        const abs = absFs(workspaceId, relPath);
        await this.remote.downloadFile(workspaceId, relPath, abs);
        const h = await sha1OfFile(abs).catch(() => undefined);
        if (h) {this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash: h } });}
        return;
      }
    }

    // C) extras-only (e.g., delete/rename) are handled in their specific handlers.
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

  private async confirmPolicyAction(
    workspaceId: WorkspaceId,
    mode: 'upload' | 'download' | 'delete' | 'move',
    allowDiff: boolean,
    relPath: RelPath,
    oldPath?: RelPath
  ): Promise<'proceed' | 'diff' | 'cancel'> {
    const label =
      mode === 'upload'   ? 'Upload' :
      mode === 'download' ? 'Download' :
      mode === 'delete'   ? 'Delete from Remote' : 'Move on Remote';

    const message = `LiveSync: ${label} “${(relPath as string) || '.'}”?`;
    const buttons = (allowDiff ? (['Proceed', 'Show Diff', 'Cancel'] as const) : (['Proceed', 'Cancel'] as const));

    const choice = await vscode.window.showWarningMessage(message, { modal: true }, ...buttons);
    if (choice === 'Proceed') {return 'proceed';}
    if (choice === 'Show Diff') {
      await vscode.commands.executeCommand('livesync.experimental.node.showDiff', {
        kind: 'entry',
        workspaceId,
        path: relPath,
      });

      const display = oldPath ? `${oldPath} → ${relPath}` : relPath;
      const again = await vscode.window.showInformationMessage(
        `Proceed to ${label.toLowerCase()} “${display}”?`,
        'Proceed', 'Cancel'
      );
      return again === 'Proceed' ? 'proceed' : 'cancel';
    }
    return 'cancel';
  }
}
