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
import { restoreRemoteSubtree } from '@infra/helpers/index';
import { RelPath, WorkspaceId } from '../../domain/types';

export class FileEventBridge {
  private readonly operationQueue = new FileOperationQueue();
  
  // Deduplication: track recent VS Code operations to prevent watcher duplicates
  private readonly vscodeOps = new Map<string, number>(); // key -> timestamp
  private readonly DEDUPE_WINDOW_MS = 300;
  
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly remote: RemotePort
  ) {}

  register(disposables: vscode.Disposable[]): void {
    // PRE-TRACK: onWill events fire BEFORE operations (eliminates race conditions)
    disposables.push(vscode.workspace.onWillCreateFiles((e) => this.preTrackCreate(e)));
    disposables.push(vscode.workspace.onWillDeleteFiles((e) => this.preTrackDelete(e)));
    disposables.push(vscode.workspace.onWillRenameFiles((e) => this.preTrackRename(e)));
    disposables.push(vscode.workspace.onWillSaveTextDocument((e) => this.preTrackSave(e)));

    // PROCESS: onDid events fire AFTER operations complete (apply policy + sync)
    disposables.push(vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)));
    disposables.push(vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)));
    disposables.push(vscode.workspace.onDidRenameFiles((e) => this.onRename(e)));
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));
    disposables.push(vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d)));

    // External changes (terminal/git/OS): watch all folders
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
      watcher.onDidCreate((uri) => this.onExternalCreate(uri));
      watcher.onDidChange((uri) => this.onExternalChange(uri));
      watcher.onDidDelete((uri) => this.onExternalDelete(uri));
      disposables.push(watcher);
    }

    disposables.push({
      dispose: () => {
        this.operationQueue.clear();
        this.vscodeOps.clear();
      }
    });
  }

  // ====================================================================================
  // Helper methods
  // ====================================================================================

  private getWorkspaceInfo(uri: vscode.Uri): { workspaceId: WorkspaceId; relPath: RelPath } | null {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return null;
    return {
      workspaceId: stringToWsId(folder.uri.fsPath),
      relPath: relFromAbs(stringToWsId(folder.uri.fsPath), uri.fsPath)
    };
  }

  private trackVSCodeOp(workspaceId: WorkspaceId, relPath: RelPath): void {
    const key = `${workspaceId}:${relPath}`;
    this.vscodeOps.set(key, Date.now());
    
    // Auto-cleanup after window expires
    setTimeout(() => {
      const ts = this.vscodeOps.get(key);
      if (ts && Date.now() - ts >= this.DEDUPE_WINDOW_MS) {
        this.vscodeOps.delete(key);
      }
    }, this.DEDUPE_WINDOW_MS + 50);
  }

  private isRecentVSCodeOp(workspaceId: WorkspaceId, relPath: RelPath): boolean {
    const key = `${workspaceId}:${relPath}`;
    const ts = this.vscodeOps.get(key);
    return ts ? Date.now() - ts < this.DEDUPE_WINDOW_MS : false;
  }

  private trackUri(uri: vscode.Uri): void {
    const info = this.getWorkspaceInfo(uri);
    if (info) {
      this.trackVSCodeOp(info.workspaceId, info.relPath);
    }
  }

  private async shouldIgnore(workspaceId: WorkspaceId, relPath: RelPath): Promise<boolean> {
    const eff = await this.config.getById(workspaceId);
    const rules = compile(eff.ignoreGlobs);
    return ignored(relPath, rules);
  }

  private async uploadFileToRemote(workspaceId: WorkspaceId, relPath: RelPath): Promise<void> {
    const absLocal = absFs(workspaceId, relPath);
    await this.remote.uploadFile(workspaceId, relPath, absLocal);
    
    const hash = await sha256OfFile(absLocal).catch(() => undefined);
    if (hash) {
      this.state.applyRemote({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash }
      });
    }
  }

  private async uploadSubtreeToRemote(workspaceId: WorkspaceId, rootPath: string): Promise<void> {
    const localIndex = this.state.getLocalIndex(workspaceId);
    const prefix = stringToRel((rootPath as string).replace(/\\/g, '/').replace(/\/+$/, '') + '/');
    
    for (const [rel, meta] of localIndex) {
      const s = rel as string;
      if (rel === rootPath || s.startsWith(prefix)) {
        if (meta.type === 'file') {
          try {
            await this.uploadFileToRemote(workspaceId, rel);
          } catch (err) {
            logExpectedError(`FileEventBridge:uploadSubtree:${rel}`, err);
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

  private async processFileArray<T extends vscode.Uri>(
    files: readonly T[],
    handler: (info: { workspaceId: WorkspaceId; relPath: RelPath; uri: T }) => Promise<void>
  ): Promise<void> {
    await Promise.all(files.map(uri => {
      const info = this.getWorkspaceInfo(uri);
      if (!info) return Promise.resolve();

      const { workspaceId, relPath } = info;
      const queueKey = `${workspaceId}:${relPath}`;

      return this.operationQueue.enqueue(queueKey, () => 
        handler({ workspaceId, relPath, uri: uri as T })
      );
    }));
  }

  private async checkShouldPrompt(
    workspaceId: WorkspaceId,
    relPath: RelPath,
    hint: 'save' | 'create' | 'open' | 'delete' | 'move' | 'upload' | 'download',
    state: SyncStateManager,
    remote: RemotePort
  ): Promise<{ shouldPrompt: boolean; reason?: string }> {
    
    const remoteMeta = state.getRemoteIndex(workspaceId).get(relPath);

    switch (hint) {
      case 'save':
      case 'upload':
      case 'create': {
        // Fetch ACTUAL remote hash to detect if someone else modified it
        if (!remoteMeta || remoteMeta.type !== 'file') {
          return { shouldPrompt: false };
        }

        try {
          const actualRemoteHash = await remote.getFileHash(workspaceId, relPath);
          const remoteChanged = actualRemoteHash !== remoteMeta.hash;
          
          return {
            shouldPrompt: remoteChanged,
            reason: remoteChanged 
              ? 'Remote file was modified by someone else' 
              : undefined
          };
        } catch (err) {
          // Server unreachable - don't prompt, just fail silently
          logExpectedError(`checkShouldPrompt:${hint}:${relPath}`, err);
          return { shouldPrompt: false };
        }
      }

      case 'open':
      case 'download': {
        //  Fetch ACTUAL remote hash to see if it changed
        if (!remoteMeta || remoteMeta.type !== 'file') {
          return { shouldPrompt: false };
        }

        try {
          const actualRemoteHash = await remote.getFileHash(workspaceId, relPath);
          const remoteChanged = actualRemoteHash !== remoteMeta.hash;
          
          return {
            shouldPrompt: remoteChanged,
            reason: remoteChanged 
              ? 'Remote file was modified by someone else' 
              : undefined
          };
        } catch (err) {
          // Server unreachable - don't show prompt
          logExpectedError(`checkShouldPrompt:${hint}:${relPath}`, err);
          return { shouldPrompt: false };
        }
      }

      case 'delete': {
        if (!remoteMeta) {
          return { shouldPrompt: false };
        }

        try {
          const actualRemoteHash = await remote.getFileHash(workspaceId, relPath);
          const remoteChanged = actualRemoteHash !== remoteMeta.hash;
          
          return {
            shouldPrompt: remoteChanged,
            reason: remoteChanged 
              ? 'Remote file was modified before deletion' 
              : undefined
          };
        } catch (err) {
          logExpectedError(`checkShouldPrompt:delete:${relPath}`, err);
          return { shouldPrompt: false };
        }
      }

      default:
        return { shouldPrompt: false };
    }
  }

  // ====================================================================================
  // Pre-tracking (onWill events - fire BEFORE operations)
  // ====================================================================================

  private preTrackCreate(e: vscode.FileWillCreateEvent): void {
    e.files.forEach(uri => this.trackUri(uri));
  }

  private preTrackDelete(e: vscode.FileWillDeleteEvent): void {
    e.files.forEach(uri => this.trackUri(uri));
  }

  private preTrackRename(e: vscode.FileWillRenameEvent): void {
    e.files.forEach(({ oldUri, newUri }) => {
      this.trackUri(oldUri);
      this.trackUri(newUri);
    });
  }

  private preTrackSave(e: vscode.TextDocumentWillSaveEvent): void {
    if (!e.document.isUntitled) {
      this.trackUri(e.document.uri);
    }
  }

  // ====================================================================================
  // VS Code event handlers (user actions → apply policy)
  // ====================================================================================

  private async onSave(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) return;

    const info = this.getWorkspaceInfo(doc.uri);
    if (!info) return;

    const { workspaceId, relPath } = info;
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
        return;
      }

      // 2) Apply policy for save
      if (await this.shouldIgnore(workspaceId, relPath)) return;

      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnSave);
      await maybeActByPolicy(workspaceId, relPath, policy, 'save', this.state, this.remote);
    });
  }

  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    await this.processFileArray(e.files, async ({ workspaceId, relPath, uri }) => {
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
      if (await this.shouldIgnore(workspaceId, relPath)) return;

      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnCreate);
      await maybeActByPolicy(workspaceId, relPath, policy, 'create', this.state, this.remote);
    });
  }

  private async onDelete(event: vscode.FileDeleteEvent): Promise<void> {
    await this.processFileArray(event.files, async ({ workspaceId, relPath }) => {
      // Update local index: remove file or entire subtree
      const hadLocalChildren = this.state.hasLocalChildren(workspaceId, relPath);
      if (hadLocalChildren) {
        this.state.removeLocalSubtree(workspaceId, relPath);
      } else {
        this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
      }

      // Policy on delete
      if (await this.shouldIgnore(workspaceId, relPath)) return;

      const eff = await this.config.getById(workspaceId);
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
        if (await this.shouldIgnore(workspaceId, oldRel)) return;
        
        const eff = await this.config.getById(workspaceId);
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
            if (decision !== 'proceed') return;
          }

          // Delete old path on remote
          await this.remote.deletePath(workspaceId, oldRel).catch((err) => {
            logExpectedError(`FileEventBridge:deleteOldPath:${oldRel}`, err);
          });

          // Upload new path (file or subtree)
          try {
            if (newIsDir) {
              await this.uploadSubtreeToRemote(workspaceId, newRel);
            } else {
              await this.uploadFileToRemote(workspaceId, newRel);
            }
            
            this.state.applyRemote({
              workspaceId,
              type: 'delete',
              path: oldRel
            });
          } catch (err) {
            logExpectedError(`FileEventBridge:onRename:upload:${newRel}`, err);
          }
          return;
        }

        // C) direction === 'upload' → ensure the NEW path exists on remote
        if (policy.direction === 'upload') {
          if (policy.check) {
            const decision = await confirmPolicyAction(workspaceId, 'upload', /*allowDiff*/ !newIsDir, newRel);
            if (decision !== 'proceed') return;
          }

          try {
            if (newIsDir) {
              await this.uploadSubtreeToRemote(workspaceId, newRel);
            } else {
              await this.uploadFileToRemote(workspaceId, newRel);
            }
          } catch (err) {
            logExpectedError(`FileEventBridge:onRename:directionUpload:${newRel}`, err);
          }
          return;
        }

        // D) direction === 'download' → restore the NEW path from remote
        if (policy.direction === 'download') {
          if (policy.check) {
            const decision = await confirmPolicyAction(workspaceId, 'download', false, newRel);
            if (decision !== 'proceed') return;
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
    if (doc.isUntitled) return;

    const info = this.getWorkspaceInfo(doc.uri);
    if (!info) return;

    const { workspaceId, relPath } = info;
    
    if (this.isRecentVSCodeOp(workspaceId, relPath)) {
      console.log(`[onOpen] DEDUPE: Skipped recent operation`);
      return;
    }
    this.trackVSCodeOp(workspaceId, relPath);
    
    const queueKey = `${workspaceId}:${relPath}`;

    await this.operationQueue.enqueue(queueKey, async () => {
      if (await this.shouldIgnore(workspaceId, relPath)) return;

      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnOpen);

      if (policy.check && !policy.direction && policy.extras.size === 0) {
        await showCheckInfo('open', relPath);
        return;
      }

      if (policy.direction === 'download') {
        const entry = this.state.getDiffEntry(workspaceId, relPath);
        const allowed = entry ? isDownloadable(entry.status) : true;
        if (!allowed) return;

        if (policy.check) {
          // ✅ Check if someone else modified remote file (fetches actual remote hash)
          const { shouldPrompt, reason } = await this.checkShouldPrompt(
            workspaceId,
            relPath,
            'open',
            this.state,
            this.remote
          );
          
          if (shouldPrompt) {
            const decision = await confirmPolicyAction(workspaceId, 'download', false, relPath, undefined, reason);
            if (decision !== 'proceed') return;
          }
        }

        try {
          const abs = absFs(workspaceId, relPath);
          await this.remote.downloadFile(workspaceId, relPath, abs);
          const hash = await sha256OfFile(abs);
          this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
        } catch (err) {
          logExpectedError(`FileEventBridge:onOpen:download:${relPath}`, err);
        }
      }
    });
  }

  // ====================================================================================
  // External watchers: mutate local snapshot only (avoid loops)
  // ====================================================================================

  private async handleExternalEvent(
    uri: vscode.Uri,
    handler: (workspaceId: WorkspaceId, relPath: RelPath) => Promise<void>
  ): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) return;

    const { workspaceId, relPath } = info;

    // Skip if this was a recent VS Code operation (deduplicate)
    if (this.isRecentVSCodeOp(workspaceId, relPath)) {
      return;
    }

    // Check ignore rules
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    await handler(workspaceId, relPath);
  }

  private async onExternalCreate(uri: vscode.Uri): Promise<void> {
    await this.handleExternalEvent(uri, async (workspaceId, relPath) => {
      // Probe kind; treat folders as folder nodes
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        const isDir = (stat.type & vscode.FileType.Directory) !== 0;

        if (isDir) {
          this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'folder', hash: '' } });
        } else {
          const hash = await sha256OfFile(uri.fsPath);
          this.state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
        }
      } catch {
        // If stat/hash fails, ignore; next scan will reconcile
      }
    });
  }

  private async onExternalChange(uri: vscode.Uri): Promise<void> {
    // Same as create for files: recompute hash and mark modified
    await this.onExternalCreate(uri);
  }

  private async onExternalDelete(uri: vscode.Uri): Promise<void> {
    await this.handleExternalEvent(uri, async (workspaceId, relPath) => {
      const hasChildren = this.state.hasLocalChildren(workspaceId, relPath);
      if (hasChildren) {
        this.state.removeLocalSubtree(workspaceId, relPath);
      } else {
        this.state.applyLocal({ workspaceId, type: 'delete', path: relPath });
      }
    });
  }
}