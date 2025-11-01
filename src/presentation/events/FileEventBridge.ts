import * as vscode from 'vscode';
import * as path from 'path';

import { SyncStateManager } from '@app/SyncStateManager';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { absFs } from '@infra/helpers/path/PathJoin';
import { sha256OfFile } from '@infra/helpers/hash/FileHash';
import type { RemotePort } from '@app/ports/RemotePort';

import { compile, ignored } from '@infra/helpers/ignore/Ignore';
import { relFromAbs, stringToRel, stringToWsId } from '@infra/helpers/path';
import { isDownloadable } from '@infra/helpers/diff';
import { confirmPolicyAction, maybeActByPolicy, parseActionPolicy, showCheckInfo } from '@infra/helpers/policy';
import { logExpectedError } from '@infra/helpers/logging';
import { FileOperationQueue } from '@infra/helpers/concurrency';
import { restoreRemoteSubtree } from '../../infrastructure/helpers/index';

export class FileEventBridge {
  private readonly operationQueue = new FileOperationQueue();
  
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly remote: RemotePort
  ) {}

  register(disposables: vscode.Disposable[]): void {
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));

    // FileSystemWatcher catches everything else
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
    const relPath = relFromAbs(workspaceId, doc.uri.fsPath);

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
      await maybeActByPolicy(workspaceId, relPath, policy, 'save', this.state, this.remote);
    });
  }

  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    // Process in parallel across different files, but serialize same file
    await Promise.all(e.files.map(uri => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return Promise.resolve();

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const relPath = relFromAbs(workspaceId, uri.fsPath);
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
        await maybeActByPolicy(workspaceId, relPath, policy, 'create', this.state, this.remote);
      });
    }));
  }

  private async onDelete(event: vscode.FileDeleteEvent): Promise<void> {
    await Promise.all(event.files.map(uri => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return Promise.resolve();

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const relPath = relFromAbs(workspaceId, uri.fsPath);
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
          await showCheckInfo('delete', relPath);
          return;
        }

        // B) contains 'delete' → delete on remote
        if (policy.extras.has('delete')) {
          if (policy.check) {
            const decision = await confirmPolicyAction(workspaceId, 'delete', false, relPath);
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
            const decision = await confirmPolicyAction(workspaceId, 'download', false, relPath);
            if (decision !== 'proceed') return;
          }

          try {
            const restored = await restoreRemoteSubtree(workspaceId, relPath, this.remote, this.state);
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
      const folder = vscode.workspace.getWorkspaceFolder(newUri) ??
                     vscode.workspace.getWorkspaceFolder(oldUri);
      if (!folder) return Promise.resolve();

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const oldRel = relFromAbs(workspaceId, oldUri.fsPath);
      const newRel = relFromAbs(workspaceId, newUri.fsPath);
      const queueKey = `${workspaceId}:${newRel}`;

      return this.operationQueue.enqueue(queueKey, async () => {
        // Determine if target is a file or folder
        let newIsDir = false;
        try {
          const stat = await vscode.workspace.fs.stat(newUri);
          newIsDir = (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
          return; // Target doesn't exist
        }

        // Update local snapshot
        if (newIsDir) {
          this.state.applyLocal({
            workspaceId,
            type: 'rename',
            path: oldRel,
            newPath: newRel,
            meta: { type: 'folder', hash: '' }
          });
        } else {
          try {
            const hash = await sha256OfFile(newUri.fsPath);
            this.state.applyLocal({
              workspaceId,
              type: 'rename',
              path: oldRel,
              newPath: newRel,
              meta: { type: 'file', hash }
            });
          } catch (err) {
            logExpectedError(`FileEventBridge:onRename:hash:${newRel}`, err);
            return;
          }
        }

        // Policy on move/rename
        const eff = await this.config.getById(workspaceId);
      
        const rules = compile(eff.ignoreGlobs);
        if (ignored(oldRel, rules)) { return; }
        const policy = parseActionPolicy(eff.data.actionOnMove);

        // A) check-only (no 'rename' extra) → info and done
        if (policy.check && !policy.direction && !policy.extras.has('rename')) {
          await showCheckInfo('rename', newRel, oldRel);
          return;
        }

        // B) extras.has('rename') → remote semantics = delete old + upload new (file or subtree)
        if (policy.extras.has('rename')) {
          if (policy.check) {
            const decision = await confirmPolicyAction(workspaceId, 'move', false, newRel, oldRel);
            if (decision !== 'proceed') {return;}
          }

          // Delete old path on remote
          await this.remote.deletePath(workspaceId, oldRel).catch((err) => {
            logExpectedError(`FileEventBridge:deleteOldPath:${oldRel}`, err);
          });

          if (!newIsDir) {
            // Upload single file
            const absLocal = absFs(workspaceId, newRel);
            try {
              await this.remote.uploadFile(workspaceId, newRel, absLocal);
              
              // Only update remote index if upload succeeded
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
            } catch (err) {
              logExpectedError(`FileEventBridge:onRename:upload:${newRel}`, err);
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
                  try {
                    await this.remote.uploadFile(workspaceId, rel, absLocal);
                    
                    // Only update remote index if upload succeeded
                    const h = await sha256OfFile(absLocal).catch(() => undefined);
                    if (h) {
                      this.state.applyRemote({
                        workspaceId,
                        type: 'modify',
                        path: rel,
                        meta: { type: 'file', hash: h }
                      });
                    }
                  } catch (err) {
                    logExpectedError(`FileEventBridge:onRename:folder:upload:${rel}`, err);
                  }
                } else {
                  // Folder nodes - always update (no remote operation needed)
                  this.state.applyRemote({
                    workspaceId,
                    type: 'modify',
                    path: rel,
                    meta: { type: 'folder', hash: '' }
                  });
                }
              }
            }
            
            // Delete old path after all uploads
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
            const decision = await confirmPolicyAction( workspaceId, 'upload', /*allowDiff*/ !newIsDir, newRel);
            if (decision !== 'proceed') {return;}
          }

          if (!newIsDir) {
            const absLocal = absFs(workspaceId, newRel);
            try {
              await this.remote.uploadFile(workspaceId, newRel, absLocal);
              
              // Only update remote index if upload succeeded
              const h = await sha256OfFile(absLocal).catch(() => undefined);
              if (h) {
                this.state.applyRemote({
                  workspaceId,
                  type: 'modify',
                  path: newRel,
                  meta: { type: 'file', hash: h }
                });
              }
            } catch (err) {
              logExpectedError(`FileEventBridge:onRename:directionUpload:${newRel}`, err);
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
                  try {
                    await this.remote.uploadFile(workspaceId, rel, absLocal);
                    
                    // Only update remote index if upload succeeded
                    const h = await sha256OfFile(absLocal).catch(() => undefined);
                    if (h) {
                      this.state.applyRemote({
                        workspaceId,
                        type: 'modify',
                        path: rel,
                        meta: { type: 'file', hash: h }
                      });
                    }
                  } catch (err) {
                    logExpectedError(`FileEventBridge:onRename:folder:directionUpload:${rel}`, err);
                  }
                } else {
                  // Folder nodes - always update
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
            const decision = await confirmPolicyAction(workspaceId, 'download', false, newRel);
            if (decision !== 'proceed') {return;}
          }

          const restored = await restoreRemoteSubtree(workspaceId, newRel, this.remote, this.state);
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
    const relPath = relFromAbs(workspaceId, doc.uri.fsPath);

    const queueKey = `${workspaceId}:${relPath}`;

    await this.operationQueue.enqueue(queueKey, async () => {
      const eff = await this.config.getById(workspaceId);
    
      const rules = compile(eff.ignoreGlobs);
      if (ignored(relPath, rules)) { return; }

      const policy = parseActionPolicy(eff.data.actionOnOpen);

      // check-only → info
      if (policy.check && !policy.direction && policy.extras.size === 0) {
        await showCheckInfo('open', relPath);
        return;
      }

      if (policy.direction === 'download') {
        const entry = this.state.getDiffEntry(workspaceId, relPath);
        const allowed = entry ? isDownloadable(entry.status) : true;
        if (!allowed) {return;}

        if (policy.check) {
          const decision = await confirmPolicyAction(workspaceId, 'download', false, relPath);
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
    const rel = relFromAbs(workspaceId, uri.fsPath);

    // Check ignore rules
    const eff = await this.config.getById(workspaceId);
    const rules = compile(eff.ignoreGlobs);
    if (ignored(rel as string, rules)) {
      return; // Ignore this file/folder
    }

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
    const relPath = relFromAbs(workspaceId, uri.fsPath);


    // Check ignore rules
    const eff = await this.config.getById(workspaceId);
    const rules = compile(eff.ignoreGlobs);
    if (ignored(relPath as string, rules)) {
      return; // Ignore this deletion
    }

    const hasChildren = this.state.hasLocalChildren(workspaceId, relPath);
    if (hasChildren) {
      this.state.removeLocalSubtree(workspaceId, relPath);
    } else {
      this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
    }
  }
}
