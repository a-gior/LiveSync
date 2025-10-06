import * as vscode from 'vscode';
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

  private async onDelete(e: vscode.FileDeleteEvent): Promise<void> {
    for (const uri of e.files) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) { continue; }
      const workspaceId = folder.uri.fsPath;
      const relPath = this.relativeOf(workspaceId, uri.fsPath);

      // local: remove
      this.state.applyLocal({
        workspaceId,
        type: 'delete',
        path: relPath
      });

      // actionOnDelete has special semantics:
      // - "delete": delete on remote (propagate deletion)
      // - "download": restore from remote (undo local delete)
      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnDelete);

      if (policy.extras.has('delete')) {
        await this.remote.deletePath(workspaceId, relPath);
        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
      } else if (policy.direction === 'download') {
        const absLocal = joinFs(workspaceId, relPath);
        await this.remote.downloadFile(workspaceId, relPath, absLocal);
        const hash = await sha1OfFile(absLocal);
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'file', hash }
        });
      } else {
        // no-op: leave it as a diff (removed = remote-only)
      }
    }
  }

  private async onRename(e: vscode.FileRenameEvent): Promise<void> {
    for (const { oldUri, newUri } of e.files) {
      const folder = vscode.workspace.getWorkspaceFolder(newUri) ?? vscode.workspace.getWorkspaceFolder(oldUri);
      if (!folder) { continue; }

      const workspaceId = folder.uri.fsPath;
      const oldRel = this.relativeOf(workspaceId, oldUri.fsPath);
      const newRel = this.relativeOf(workspaceId, newUri.fsPath);

      // local: delete old, add/modify new
      this.state.applyLocal({ workspaceId, type: 'delete', path: oldRel });
      try {
        const hash = await sha1OfFile(newUri.fsPath);
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: newRel,
          meta: { type: 'file', hash }
        });
      } catch {/* ignore */ }

      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnMove);

      if (policy.extras.has('rename')) {
        // If remote supports rename, you could add a dedicated call.
        // For now: delete old + upload new.
        await this.remote.deletePath(workspaceId, oldRel).catch(() => undefined);
        const absLocal = joinFs(workspaceId, newRel);
        await this.remote.uploadFile(workspaceId, newRel, absLocal);
        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
      } else if (policy.direction === 'upload') {
        const absLocal = joinFs(workspaceId, newRel);
        await this.remote.uploadFile(workspaceId, newRel, absLocal);
        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
      } else if (policy.direction === 'download') {
        // Pull new from remote, and restore old (rare intent) — skipping unless you need it
      }
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
    const folder = vscode.workspace.getWorkspaceFolder(uri); if (!folder) { return; }
    const workspaceId = folder.uri.fsPath; const rel = this.relativeOf(workspaceId, uri.fsPath);
    this.state.applyLocal({ workspaceId, type: 'delete', path: rel });
  }

  // ---------- core acting logic

  private async maybeActByPolicy(
    workspaceId: string,
    relPath: string,
    policy: ReturnType<typeof parseActionPolicy>,
    _hint: 'save' | 'create' | 'open' | 'rename'
  ): Promise<void> {
    if (!policy.direction && !policy.extras.size) {
      return;
    }

    const entry = this.state.getDiffEntry(workspaceId, relPath);

    if (policy.direction === 'upload') {
      const allowed = entry ? (policy.check ? canUpload(entry.status) : true) : true;
      if (allowed) {
        const abs = joinFs(workspaceId, relPath);
        await this.remote.uploadFile(workspaceId, relPath, abs);
        const newRemote = await this.remote.list(workspaceId);
        this.state.setRemoteIndex(workspaceId, newRemote);
      }
    } else if (policy.direction === 'download') {
      const allowed = entry ? (policy.check ? canDownload(entry.status) : true) : true;
      if (allowed) {
        const abs = joinFs(workspaceId, relPath);
        await this.remote.downloadFile(workspaceId, relPath, abs);
        const hash = await sha1OfFile(abs);
        this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
      }
    }
  }


  // ---------- utils
  private relativeOf(workspaceId: string, absFsPath: string): string {
    const normRoot = workspaceId.replace(/\\/g, '/').replace(/\/+$/, '');
    const normAbs = absFsPath.replace(/\\/g, '/');
    return normAbs.startsWith(normRoot + '/') ? normAbs.slice(normRoot.length + 1) : '';
  }
}
