import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { SyncStateManager } from '../../application/SyncStateManager';
import { WorkspaceConfigService } from '../../infrastructure/config/WorkspaceConfigService';
import { parseActionPolicy, canUpload, canDownload } from '../../infrastructure/config/ActionPolicy';
import { joinFs } from '../../infrastructure/workspace/PathJoin';
import { sha1OfFile } from '../../infrastructure/files/FileHash';
import type { RemotePort } from '../../application/ports/RemotePort';

export class FileEventBridge {
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly remote: RemotePort
  ) {}

  register(disposables: vscode.Disposable[]): void {
    // VS Code-initiated file ops 
    disposables.push(vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)));
    disposables.push(vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)));
    disposables.push(vscode.workspace.onDidRenameFiles((e) => this.onRename(e)));
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));

    // External changes (terminal/git/OS)
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
      watcher.onDidCreate((uri) => this.onExternalCreate(uri));
      watcher.onDidChange((uri) => this.onExternalChange(uri));
      watcher.onDidDelete((uri) => this.onExternalDelete(uri));
      disposables.push(watcher);

      disposables.push(vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d)));
    }
  }

  // ---------- handlers

  private async onSave(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) { return; }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) { return; }

    const workspaceId = folder.uri.fsPath;
    const relPath = this.relativeOf(workspaceId, doc.uri.fsPath);

    // Apply local change (hash new content)
    try {
      const hash = await sha1OfFile(doc.uri.fsPath);
      this.state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash }
      });
    } catch {
      // ignore hash errors
    }

    // Auto-action: actionOnSave e.g. "check&save" => check + upload
    const eff = await this.config.getById(workspaceId);
    const policy = parseActionPolicy(eff.data.actionOnSave);

    await this.maybeActByPolicy(workspaceId, relPath, policy, /*eventHint*/'save');
  }

  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    for (const uri of e.files) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) { continue; }
      const workspaceId = folder.uri.fsPath;
      const relPath = this.relativeOf(workspaceId, uri.fsPath);

      // local index: add file if file; for folders, children events will come
      try {
        const hash = await sha1OfFile(uri.fsPath);
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'file', hash }
        });
      } catch {/* ignore */}

      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnCreate);
      await this.maybeActByPolicy(workspaceId, relPath, policy, 'create');
    }
  }

  private async onDelete(event: vscode.FileDeleteEvent): Promise<void> {
    for (const uri of event.files) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) {
        continue;
      }
      const workspaceId = folder.uri.fsPath;
      const relPath = this.relativeOf(workspaceId, uri.fsPath);

      // Update local index: remove leaf or subtree
      const hadLocalChildren = this.state.hasLocalChildren(workspaceId, relPath);
      if (hadLocalChildren) {
        this.state.removeLocalSubtree(workspaceId, relPath);
      } else {
        this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
      }

      const effective = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(effective.data.actionOnDelete);

      // A) check-only → info popup, no action
      if (policy.check && !policy.direction && policy.extras.size === 0) {
        await this.showCheckInfo('delete', relPath);
        continue;
      }

      // B) check&delete or delete → remote delete
      if (policy.extras.has('delete')) {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(workspaceId, relPath, 'delete', /*allowDiff*/ false);
          if (decision !== 'proceed') {
            continue;
          }
        }
        await this.remote.deletePath(workspaceId, relPath);
        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
        continue;
      }

      // C) check&download or download → restore from remote (file or subtree)
      if (policy.direction === 'download') {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(workspaceId, relPath, 'download', /*allowDiff*/ false);
          if (decision !== 'proceed') {
            continue;
          }
        }
        const restored = await this.restoreRemoteSubtree(workspaceId, relPath);
        if (restored === 0) {
          // Try exact file as a final attempt
          const absLocal = joinFs(workspaceId, relPath);
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(require('path').dirname(absLocal)));
          await this.remote.downloadFile(workspaceId, relPath, absLocal).catch(() => undefined);
          try {
            const hash = await sha1OfFile(absLocal);
            this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
          } catch { /* ignore */ }
        }
        continue;
      }

      // D) none → leave as a diff (remote-only)
    }
  }

  private async onRename(event: vscode.FileRenameEvent): Promise<void> {
    for (const { oldUri, newUri } of event.files) {
      const folder =
        vscode.workspace.getWorkspaceFolder(newUri) ?? vscode.workspace.getWorkspaceFolder(oldUri);
      if (!folder) {
        continue;
      }

      const workspaceId = folder.uri.fsPath;
      const oldRel = this.relativeOf(workspaceId, oldUri.fsPath);
      const newRel = this.relativeOf(workspaceId, newUri.fsPath);

      // Update local state: remove old; add/modify new if it's a file.
      this.state.applyLocal({ workspaceId, type: 'delete', path: oldRel });
      try {
        const stat = await vscode.workspace.fs.stat(newUri);
        const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;

        if (!isDirectory) {
          const hash = await sha1OfFile(newUri.fsPath);
          this.state.applyLocal({
            workspaceId,
            type: 'modify',
            path: newRel,
            meta: { type: 'file', hash }
          });
        }
        // If it’s a directory, we rely on file watch events to populate children as they appear under the new path.
      } catch {
        // Ignore errors probing the new path (race with FS updates is possible).
      }

      const effective = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(effective.data.actionOnMove);

      // A) check-only → info popup, no action
      if (policy.check && !policy.direction && !policy.extras.has('rename')) {
        await this.showCheckInfo('rename', `${oldRel} → ${newRel}`);
        continue;
      }

      // B) Full "rename/move" policy (extras.has('rename'))
      if (policy.extras.has('rename')) {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(
            workspaceId,
            `${oldRel} → ${newRel}`,
            'move',
            /*allowDiff*/ false
          );
          if (decision !== 'proceed') {
            continue;
          }
        }

        // Delete old on remote, then upload the new path (file or subtree).
        await this.remote.deletePath(workspaceId, oldRel).catch(() => undefined);

        // Upload file-or-folder at newRel
        const stat = await vscode.workspace.fs.stat(newUri).catch(() => undefined);
        const isDirectory = !!stat && (stat.type & vscode.FileType.Directory) !== 0;

        if (!isDirectory) {
          const absLocal = joinFs(workspaceId, newRel);
          await this.remote.uploadFile(workspaceId, newRel, absLocal);
        } else {
          // Folder: upload all local files under newRel from the local index snapshot
          const localIndex = this.state.getLocalIndexSnapshot(workspaceId);
          const prefix = newRel.replace(/\\/g, '/').replace(/\/+$/, '') + '/';

          for (const [rel, meta] of localIndex.entries()) {
            if (rel === newRel || rel.startsWith(prefix)) {
              if (meta.type === 'file') {
                const absLocal = joinFs(workspaceId, rel);
                await this.remote.uploadFile(workspaceId, rel, absLocal);
              }
            }
          }
        }

        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
        continue;
      }

      // C) direction === 'upload' → ensure the NEW path exists remotely
      if (policy.direction === 'upload') {
        const stat = await vscode.workspace.fs.stat(newUri).catch(() => undefined);
        const isDirectory = !!stat && (stat.type & vscode.FileType.Directory) !== 0;

        if (policy.check) {
          const decision = await this.confirmPolicyAction(
            workspaceId,
            newRel,
            'upload',
            /*allowDiff*/ (stat && !isDirectory) ? true : false
          );
          if (decision !== 'proceed') {
            continue;
          }
        }

        if (!isDirectory) {
          const absLocal = joinFs(workspaceId, newRel);
          await this.remote.uploadFile(workspaceId, newRel, absLocal);
        } else {
          const localIndex = this.state.getLocalIndexSnapshot(workspaceId);
          const prefix = newRel.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
          for (const [rel, meta] of localIndex.entries()) {
            if (rel === newRel || rel.startsWith(prefix)) {
              if (meta.type === 'file') {
                const absLocal = joinFs(workspaceId, rel);
                await this.remote.uploadFile(workspaceId, rel, absLocal);
              }
            }
          }
        }

        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
        continue;
      }

      // D) direction === 'download' → pull the NEW path from remote (file or subtree)
      if (policy.direction === 'download') {
        if (policy.check) {
          const decision = await this.confirmPolicyAction(
            workspaceId,
            newRel,
            'download',
            /*allowDiff*/ false
          );
          if (decision !== 'proceed') {
            continue;
          }
        }

        // If remote has subtree at newRel, restore it; otherwise try exact file.
        const restored = await this.restoreRemoteSubtree(workspaceId, newRel);
        if (restored === 0) {
          const absLocal = joinFs(workspaceId, newRel);
          await this.remote.downloadFile(workspaceId, newRel, absLocal).catch(() => undefined);
          try {
            const hash = await sha1OfFile(absLocal);
            this.state.applyLocal({
              workspaceId,
              type: 'modify',
              path: newRel,
              meta: { type: 'file', hash }
            });
          } catch { /* ignore */ }
        }
        continue;
      }

      // E) no policy → nothing to do
    }
  }

  private async onOpen(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {
      return;
    }
    const workspaceId = folder.uri.fsPath;
    const relPath = this.relativeOf(workspaceId, doc.uri.fsPath);

    const effective = await this.config.getById(workspaceId);
    const policy = parseActionPolicy(effective.data.actionOnOpen);

    // check-only → info
    if (policy.check && !policy.direction && policy.extras.size === 0) {
      await this.showCheckInfo('open', relPath);
      return;
    }

    if (policy.direction === 'download') {
      const entry = this.state.getDiffEntry(workspaceId, relPath);
      const allowed = entry ? canDownload(entry.status) : true;

      if (!allowed) {
        return;
      }

      if (policy.check) {
        const decision = await this.confirmPolicyAction(workspaceId, relPath, 'download', /*allowDiff*/ false);
        if (decision !== 'proceed') {
          return;
        }
      }

      const abs = joinFs(workspaceId, relPath);
      await this.remote.downloadFile(workspaceId, relPath, abs);
      const hash = await sha1OfFile(abs);
      this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
    }
  }


  // External watchers: only update local index; no auto-action (avoid loops)
  private async onExternalCreate(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri); if (!folder) { return; }
    const workspaceId = folder.uri.fsPath; const rel = this.relativeOf(workspaceId, uri.fsPath);
    try {
      const hash = await sha1OfFile(uri.fsPath);
      this.state.applyLocal({ workspaceId, type: 'modify', path: rel, meta: { type: 'file', hash } });
    } catch {}
  }

  private async onExternalChange(uri: vscode.Uri): Promise<void> {
    await this.onExternalCreate(uri); // same as create → rehash and modify
  }
  
  private async onExternalDelete(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return;
    }
    const workspaceId = folder.uri.fsPath;
    const relPath = this.relativeOf(workspaceId, uri.fsPath);

    const hasChildren = this.state.hasLocalChildren(workspaceId, relPath);
    if (hasChildren) {
      this.state.removeLocalSubtree(workspaceId, relPath);
    } else {
      this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
    }
  }

  /**
   * Restore a folder (and its descendants) from remote to local.
   * Returns the number of files restored.
   */
  private async restoreRemoteSubtree(workspaceId: string, folderRel: string): Promise<number> {
    const remoteIndex = await this.remote.list(workspaceId);

    const normalized = folderRel.replace(/\\/g, '/').replace(/\/+$/, '');
    const prefix = normalized ? normalized + '/' : '';

    // If remote has an exact file at folderRel, treat it as a single-file restore.
    const exact = remoteIndex.get(normalized);
    const targets: string[] = [];

    if (exact?.type === 'file') {
      targets.push(normalized);
    } else {
      for (const rel of remoteIndex.keys()) {
        if (rel === normalized || (prefix && rel.startsWith(prefix))) {
          const entry = remoteIndex.get(rel)!;
          if (entry.type === 'file') {
            targets.push(rel);
          }
        }
      }
    }

    if (targets.length === 0) {
      return 0;
    }

    let restored = 0;
    // Optional: if your SyncStateManager supports explicit batching, wrap with begin/end here.
    for (const rel of targets) {
      const absLocal = joinFs(workspaceId, rel);
      await fsp.mkdir(path.dirname(absLocal), { recursive: true });
      await this.remote.downloadFile(workspaceId, rel, absLocal);
      const hash = await sha1OfFile(absLocal);
      this.state.applyLocal({
        workspaceId,
        type: 'modify',
        path: rel,
        meta: { type: 'file', hash }
      });
      restored += 1;
    }
    return restored;
  }



  // ---------- core acting logic

  private async maybeActByPolicy(
    workspaceId: string,
    relPath: string,
    policy: ReturnType<typeof parseActionPolicy>,
    hint: 'save' | 'create' | 'open' | 'rename' | 'delete'
  ): Promise<void> {
    // A) check-only → info popup, NO action
    if (policy.check && !policy.direction && policy.extras.size === 0) {
      await this.showCheckInfo(hint, relPath);
      return;
    }

    // B) direction-only (upload/download), possibly with check
    if (policy.direction) {
      const entry = this.state.getDiffEntry(workspaceId, relPath);
      const allowed = policy.direction === 'upload'
        ? (entry ? canUpload(entry.status) : true)
        : (entry ? canDownload(entry.status) : true);

      if (!allowed) {
        return;
      }

      if (policy.check) {
        const allowDiff =
          policy.direction === 'upload' && (hint === 'save' || hint === 'create' || hint === 'rename');
        const decision = await this.confirmPolicyAction(workspaceId, relPath, policy.direction, allowDiff);
        if (decision !== 'proceed') {
          return;
        }
      }

      if (policy.direction === 'upload') {
        const abs = joinFs(workspaceId, relPath);
        await this.remote.uploadFile(workspaceId, relPath, abs);
        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
        return;
      } else {
        const abs = joinFs(workspaceId, relPath);
        await this.remote.downloadFile(workspaceId, relPath, abs);
        const hash = await sha1OfFile(abs);
        this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
        return;
      }
    }

    // C) extras-only (e.g. delete/rename) are handled in the specific event handlers.
  }



  // ---------- utils
  private relativeOf(workspaceId: string, absFsPath: string): string {
    const normRoot = workspaceId.replace(/\\/g, '/').replace(/\/+$/, '');
    const normAbs = absFsPath.replace(/\\/g, '/');
    return normAbs.startsWith(normRoot + '/') ? normAbs.slice(normRoot.length + 1) : '';
  }

  private async showCheckInfo(hint: 'save' | 'create' | 'open' | 'rename' | 'delete', relPath: string): Promise<void> {
    const verb =
      hint === 'save'   ? 'Saved'
    : hint === 'create' ? 'Created'
    : hint === 'open'   ? 'Opened'
    : hint === 'rename' ? 'Renamed'
    :                     'Deleted';

    const message = `LiveSync (check): ${verb} “${relPath || '.'}”. No sync action taken (policy = check).`;
    await vscode.window.showInformationMessage(message);
  }

  private async confirmPolicyAction(
    workspaceId: string,
    relPath: string,
    mode: 'upload' | 'download' | 'delete' | 'move',
    allowDiff: boolean
  ): Promise<'proceed' | 'diff' | 'cancel'> {
    const label =
      mode === 'upload'   ? 'Upload'
    : mode === 'download' ? 'Download'
    : mode === 'delete'   ? 'Delete from Remote'
    :                       'Move on Remote';

    const message = `LiveSync: ${label} “${relPath || '.'}”?`;
    const buttons = allowDiff ? ['Proceed', 'Show Diff', 'Cancel'] as const : ['Proceed', 'Cancel'] as const;

    const choice = await vscode.window.showWarningMessage(message, { modal: true }, ...buttons);
    if (choice === 'Proceed') {
      return 'proceed';
    }
    if (choice === 'Show Diff') {
      await vscode.commands.executeCommand('livesync.experimental.node.showDiff', {
        kind: 'entry',
        workspaceId,
        path: relPath
      });
      // Ask once more after diff to avoid accidental action.
      const again = await vscode.window.showInformationMessage(`Proceed to ${label.toLowerCase()} “${relPath || '.'}”?`, 'Proceed', 'Cancel');
      return again === 'Proceed' ? 'proceed' : 'cancel';
    }
    return 'cancel';
  }

}
