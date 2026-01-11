import * as vscode from 'vscode';

import { SyncStateManager } from '@app/SyncStateManager';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import type { RemotePort } from '@app/ports/RemotePort';
import { NotificationStatusBar } from '@presentation/statusbar/NotificationStatusBar';

import { ActionPolicy, RelPath, WorkspaceId } from '@domain/types';
import { relFromAbs, stringToWsId } from '@helpers/path';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';
import { FileOperationQueue } from '@helpers/concurrency';

// Helper imports
import { ensureFreshRemoteSnapshot, ensureFreshLocalSnapshot } from '@helpers/snapshot';
import { updateLocalSnapshot } from '@helpers/snapshot/update';
import { detectConflict, hasIgnoredConflict } from '@helpers/conflict/detector';
import { resolveConflict, showCheckInfo } from '@helpers/conflict/resolver';
import { isCheckOnlyPolicy, isNoOpPolicy, requiresLocalSnapshot, requiresRemoteSnapshot } from '@helpers/policy/utils';
import { markConflictIgnored, clearIgnoredConflictIfResolved } from '@helpers/conflict/tracker';
import { executeUpload, executeDownload, executeDelete, executeRename } from '@helpers/action/executor';
import { notifySuccess, notifyError } from '@helpers/notification';
import { parseActionPolicy } from '@helpers/policy/parser';

/**
 * FileEventBridge - Central event handler for file operations
 * 
 * Handles two types of events:
 * 1. Internal VSCode events (user actions in UI) → Update snapshot + apply policy + sync
 * 2. External file changes (terminal/git/OS) → Update local snapshot only
 */
export class FileEventBridge {
  private readonly operationQueue = new FileOperationQueue();
  private readonly inFlightOps = new Set<string>();
  
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly validator: ConfigValidator,
    private readonly remote: RemotePort,
    private readonly notifications: NotificationStatusBar
  ) {}

  /**
   * Register all event handlers
   */
  register(disposables: vscode.Disposable[]): void {
    // Internal VSCode events (two-phase)
    disposables.push(vscode.workspace.onWillCreateFiles((e) => this.preTrackCreate(e)));
    disposables.push(vscode.workspace.onWillDeleteFiles((e) => this.preTrackDelete(e)));
    disposables.push(vscode.workspace.onWillRenameFiles((e) => this.preTrackRename(e)));
    disposables.push(vscode.workspace.onWillSaveTextDocument((e) => this.preTrackSave(e)));

    disposables.push(vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)));
    disposables.push(vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)));
    disposables.push(vscode.workspace.onDidRenameFiles((e) => this.onRename(e)));
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));
    disposables.push(vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d)));

    // External file changes (FileSystemWatcher)
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidCreate((uri) => this.onExternalCreate(uri));
      watcher.onDidChange((uri) => this.onExternalChange(uri));
      watcher.onDidDelete((uri) => this.onExternalDelete(uri));

      disposables.push(watcher);
    }
  }

  // ==========================================================================
  // PRE-TRACK PHASE (onWill* - mark operations as in-flight)
  // ==========================================================================

  private preTrackCreate(e: vscode.FileWillCreateEvent): void {
    for (const uri of e.files) {
      const info = this.getWorkspaceInfo(uri);
      if (!info) {continue;}
      this.inFlightOps.add(`${info.workspaceId}:${info.relPath}`);
    }
  }

  private preTrackDelete(e: vscode.FileWillDeleteEvent): void {
    for (const uri of e.files) {
      const info = this.getWorkspaceInfo(uri);
      if (!info) {continue;}
      this.inFlightOps.add(`${info.workspaceId}:${info.relPath}`);
    }
  }

  private preTrackRename(e: vscode.FileWillRenameEvent): void {
    for (const { oldUri, newUri } of e.files) {
      const oldInfo = this.getWorkspaceInfo(oldUri);
      const newInfo = this.getWorkspaceInfo(newUri);
      if (oldInfo) {this.inFlightOps.add(`${oldInfo.workspaceId}:${oldInfo.relPath}`);}
      if (newInfo) {this.inFlightOps.add(`${newInfo.workspaceId}:${newInfo.relPath}`);}
    }
  }

  private preTrackSave(e: vscode.TextDocumentWillSaveEvent): void {
    if (e.document.isUntitled) {return;}
    const info = this.getWorkspaceInfo(e.document.uri);
    if (!info) {return;}
    this.inFlightOps.add(`${info.workspaceId}:${info.relPath}`);
  }

  // ==========================================================================
  // PROCESS PHASE (onDid* - update snapshot + apply policy + sync)
  // ==========================================================================

  /**
   * Handle file creation (actionOnCreate)
   */
  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    await this.processFileArray(e.files, async ({ workspaceId, relPath, uri }) => {
      const queueKey = `${workspaceId}:${relPath}`;
      
      await this.operationQueue.enqueue(queueKey, 'create', async () => {
        // Update local snapshot (after conflict check)
        try {
          await updateLocalSnapshot(this.state, workspaceId, relPath, uri);
        } catch (err) {
          logExpectedError(`onCreate:updateSnapshot:${relPath}`, err);
          return;
        }

        // Pre-flight checks
        const policy = await this.shouldProceedWithEvent(workspaceId, relPath, 'actionOnCreate');
        if (!policy) {return;}
        
        // Refresh remote snapshot (if needed) - BEFORE updating local
        if (requiresRemoteSnapshot(policy)) {
          await ensureFreshRemoteSnapshot(this.state, this.remote, workspaceId, relPath);
        }
        
        // Detect conflict - BEFORE updating local snapshot
        let conflict = null;
        if (policy.check) {
          conflict = detectConflict('create', workspaceId, relPath, this.state);
        }
        
        // Handle check-only
        if (isCheckOnlyPolicy(policy)) {
          showCheckInfo(conflict);
          return;
        }
        
        // Resolve conflict
        if (conflict) {
          const resolution = await resolveConflict(conflict, workspaceId, relPath);
          
          if (resolution.action === 'cancel') {
            return;
          }
          
          if (resolution.action === 'ignore') {
            markConflictIgnored(this.state, workspaceId, relPath, conflict);
            return;
          }
        }
        
        // Execute action
        try {
          if (conflict) {
            // Download remote file (safer than overwriting)
            await executeDownload(this.remote, this.state, workspaceId, relPath);
            notifySuccess(this.notifications, 'download', relPath);
          } else if (policy.direction === 'upload') {
            await executeUpload(this.remote, this.state, workspaceId, relPath);
            notifySuccess(this.notifications, 'upload', relPath);
          }
        } catch (err) {
          logExpectedError(`onCreate:execute:${relPath}`, err);
          notifyError(this.notifications, conflict ? 'download' : 'upload', relPath);
          return;
        }
        
        // Clear ignored conflict
        clearIgnoredConflictIfResolved(this.state, workspaceId, relPath);
      });
      
      setTimeout(() => this.inFlightOps.delete(queueKey), 100);
    });
  }

  /**
   * Handle file save (actionOnSave)
   */
  private async onSave(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) {return;}

    const info = this.getWorkspaceInfo(doc.uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const queueKey = `${workspaceId}:${relPath}`;

    await this.operationQueue.enqueue(queueKey, 'save', async () => {
      // Pre-flight checks
      const policy = await this.shouldProceedWithEvent(workspaceId, relPath, 'actionOnSave');
      if (!policy) {return;}
      
      // Refresh remote snapshot (if needed) - BEFORE updating local
      if (requiresRemoteSnapshot(policy)) {
        await ensureFreshRemoteSnapshot(this.state, this.remote, workspaceId, relPath);
      }
      
      // Detect conflict - BEFORE updating local snapshot
      let conflict = null;
      if (policy.check) {
        conflict = detectConflict('save', workspaceId, relPath, this.state);
      }
      
      // Update local snapshot (after conflict check)
      try {
        const hash = await sha256OfFile(doc.uri.fsPath);
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'file', hash }
        });
      } catch (err) {
        logExpectedError(`onSave:updateSnapshot:${relPath}`, err);
        return;
      }
      
      // Handle check-only
      if (isCheckOnlyPolicy(policy)) {
        showCheckInfo(conflict);
        return;
      }
      
      // Resolve conflict
      if (conflict) {
        const resolution = await resolveConflict(conflict, workspaceId, relPath);
        
        if (resolution.action === 'cancel') {
          return;
        }
        
        if (resolution.action === 'ignore') {
          markConflictIgnored(this.state, workspaceId, relPath, conflict);
          return;
        }
      }
      
      // Execute action
      try {
        if (policy.direction === 'upload') {
          await executeUpload(this.remote, this.state, workspaceId, relPath);
          notifySuccess(this.notifications, 'upload', relPath);
        }
      } catch (err) {
        logExpectedError(`onSave:execute:${relPath}`, err);
        notifyError(this.notifications, 'upload', relPath);
        return;
      }
      
      // Clear ignored conflict
      clearIgnoredConflictIfResolved(this.state, workspaceId, relPath);
    });
    
    setTimeout(() => this.inFlightOps.delete(queueKey), 100);
  }

  /**
   * Handle file deletion (actionOnDelete)
   * Note: Updates local snapshot FIRST, then checks policy
   */
  private async onDelete(e: vscode.FileDeleteEvent): Promise<void> {
    await this.processFileArray(e.files, async ({ workspaceId, relPath }) => {
      const queueKey = `${workspaceId}:${relPath}`;
      
      await this.operationQueue.enqueue(queueKey, 'delete', async () => {
        // 1. Update local snapshot (remove from local)
        const oldLocalMeta = this.state.getLocalMeta(workspaceId, relPath);
        const hadChildren = this.state.hasLocalChildren(workspaceId, relPath);
        if (hadChildren) {
          this.state.removeLocalSubtree(workspaceId, relPath);
        } else {
          this.state.applyLocal({
            workspaceId,
            type: 'delete',
            path: relPath
          });
        }
        
        // 2. Check if conflict already ignored (and clear it - file is deleted)
        if (hasIgnoredConflict(this.state, workspaceId, relPath)) {
          clearIgnoredConflictIfResolved(this.state, workspaceId, relPath);
          // Continue processing - don't return
        }
        
        // 3. Check ignore patterns
        if (await this.shouldIgnore(workspaceId, relPath)) {
          return;
        }
        
        // 4. Parse policy
        const cfg = await this.config.getById(workspaceId);
        const policy = parseActionPolicy(cfg.data.actionOnDelete);
        
        if (isNoOpPolicy(policy)) {
          return;
        }
        
        // 5. Config validity check (AFTER policy check)
        const validationResult = await this.validator.getCached(workspaceId);
        if (!validationResult.isValid) {
          return;
        }
        
        // 6. Refresh remote snapshot (if needed)
        if (requiresRemoteSnapshot(policy)) {
          await ensureFreshRemoteSnapshot(this.state, this.remote, workspaceId, relPath);
        }
        
        // 7. Detect conflict
        let conflict = null;
        if (policy.check) {
          conflict = detectConflict('delete', workspaceId, relPath, this.state, oldLocalMeta);
        }
        
        // 8. Handle check-only
        if (isCheckOnlyPolicy(policy)) {
          showCheckInfo(conflict);
          return;
        }
        
        // 9. Resolve conflict
        if (conflict) {
          const resolution = await resolveConflict(conflict, workspaceId, relPath);
          
          if (resolution.action === 'cancel') {
            return;
          }
          
          if (resolution.action === 'ignore') {
            markConflictIgnored(this.state, workspaceId, relPath, conflict);
            return;
          }
        }
        
        // 10. Execute action
        try {
          if (policy.extras.has('delete')) {
            await executeDelete(this.remote, this.state, workspaceId, relPath);
            notifySuccess(this.notifications, 'delete', relPath);
          }
        } catch (err) {
          logExpectedError(`onDelete:execute:${relPath}`, err);
          notifyError(this.notifications, 'delete', relPath);
          return;
        }
        
        // 11. Clear ignored conflict (redundant but consistent)
        clearIgnoredConflictIfResolved(this.state, workspaceId, relPath);
      });
      
      setTimeout(() => this.inFlightOps.delete(queueKey), 100);
    });
  }

  /**
   * Handle file move/rename (actionOnMove)
   * Note: Updates local snapshot FIRST, then checks policy
   */
  private async onRename(e: vscode.FileRenameEvent): Promise<void> {
    await Promise.all(e.files.map(async ({ oldUri, newUri }) => {
      const folder = vscode.workspace.getWorkspaceFolder(newUri) ?? 
                     vscode.workspace.getWorkspaceFolder(oldUri);
      if (!folder) {return;}

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const oldRel = relFromAbs(workspaceId, oldUri.fsPath);
      const newRel = relFromAbs(workspaceId, newUri.fsPath);
      const queueKey = `${workspaceId}:${newRel}`;

      await this.operationQueue.enqueue(queueKey, 'move', async () => {
        // 1. Update local snapshot
        let isDir = false;
        try {
          const stat = await vscode.workspace.fs.stat(newUri);
          isDir = (stat.type & vscode.FileType.Directory) !== 0;
          
          if (isDir) {
            this.state.applyLocal({
              workspaceId,
              type: 'move',
              path: oldRel,
              newPath: newRel,
              meta: { type: 'folder', hash: '' }
            });
          } else {
            const hash = await sha256OfFile(newUri.fsPath);
            this.state.applyLocal({
              workspaceId,
              type: 'move',
              path: oldRel,
              newPath: newRel,
              meta: { type: 'file', hash }
            });
          }
        } catch (err) {
          logExpectedError(`onRename:updateSnapshot:${newRel}`, err);
          return;
        }
        
        // 2. Check if conflict already ignored (check both paths)
        if (hasIgnoredConflict(this.state, workspaceId, oldRel)) {
          clearIgnoredConflictIfResolved(this.state, workspaceId, oldRel);
        }
        if (hasIgnoredConflict(this.state, workspaceId, newRel)) {
          return;
        }
        
        // 3. Check ignore patterns
        if (await this.shouldIgnore(workspaceId, oldRel)) {
          return;
        }
        
        // 4. Parse policy
        const cfg = await this.config.getById(workspaceId);
        const policy = parseActionPolicy(cfg.data.actionOnMove);
        
        if (isNoOpPolicy(policy)) {
          return;
        }
        
        // 5. Config validity check (AFTER policy check)
        const validationResult = await this.validator.getCached(workspaceId);
        if (!validationResult.isValid) {
          return;
        }
        
        // 6. Refresh remote snapshot (if needed) - check NEW path
        if (requiresRemoteSnapshot(policy)) {
          await ensureFreshRemoteSnapshot(this.state, this.remote, workspaceId, newRel);
        }
        
        // 7. Detect conflict (check if target path exists)
        let conflict = null;
        if (policy.check) {
          conflict = detectConflict('move', workspaceId, newRel, this.state);
        }
        
        // 8. Handle check-only
        if (isCheckOnlyPolicy(policy)) {
          showCheckInfo(conflict);
          return;
        }
        
        // 9. Resolve conflict
        if (conflict) {
          const resolution = await resolveConflict(conflict, workspaceId, newRel);
          
          if (resolution.action === 'cancel') {
            return;
          }
          
          if (resolution.action === 'ignore') {
            markConflictIgnored(this.state, workspaceId, newRel, conflict);
            return;
          }
        }
        
        // 10. Execute action
        try {
          if (policy.extras.has('move')) {
            await executeRename(this.remote, this.state, workspaceId, oldRel, newRel);
            notifySuccess(this.notifications, 'move', newRel);
          }
        } catch (err) {
          logExpectedError(`onRename:execute:${newRel}`, err);
          notifyError(this.notifications, 'move', newRel);
          return;
        }
        
        // 11. Clear ignored conflicts
        clearIgnoredConflictIfResolved(this.state, workspaceId, oldRel);
        clearIgnoredConflictIfResolved(this.state, workspaceId, newRel);
      });
      
      setTimeout(() => {
        this.inFlightOps.delete(`${workspaceId}:${oldRel}`);
        this.inFlightOps.delete(`${workspaceId}:${newRel}`);
      }, 100);
    }));
  }

  /**
   * Handle file open (actionOnOpen)
   */
  private async onOpen(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) {return;}

    const info = this.getWorkspaceInfo(doc.uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const queueKey = `${workspaceId}:${relPath}`;
    
    // Skip if file was just created (prevents create→open collision)
    if (this.operationQueue.hadRecentOperationAny(queueKey, ['create'])) {
      console.log(`onOpen: Skipping for recently created file: ${relPath}`);
      return;
    }

    await this.operationQueue.enqueue(queueKey, 'open', async () => {
      // Pre-flight checks
      const policy = await this.shouldProceedWithEvent(workspaceId, relPath, 'actionOnOpen');
      if (!policy) {return;}
      
      // Refresh snapshots (if needed)
      if (requiresLocalSnapshot(policy)) {
        await ensureFreshLocalSnapshot(this.state, workspaceId, relPath);
      }
      if (requiresRemoteSnapshot(policy)) {
        await ensureFreshRemoteSnapshot(this.state, this.remote, workspaceId, relPath);
      }
      
      // Detect conflict
      let conflict = null;
      if (policy.check) {
        conflict = detectConflict('open', workspaceId, relPath, this.state);
      }
      
      // Handle check-only
      if (isCheckOnlyPolicy(policy)) {
        showCheckInfo(conflict);
        return;
      }
      
      // Resolve conflict
      if (conflict) {
        const resolution = await resolveConflict(conflict, workspaceId, relPath);
        
        if (resolution.action === 'cancel') {
          return;
        }
        
        if (resolution.action === 'ignore') {
          markConflictIgnored(this.state, workspaceId, relPath, conflict);
          return;
        }
      }
      
      // Execute action
      try {
        if (policy.direction === 'download') {
          await executeDownload(this.remote, this.state, workspaceId, relPath);
          notifySuccess(this.notifications, 'download', relPath);
        }
      } catch (err) {
        logExpectedError(`onOpen:execute:${relPath}`, err);
        notifyError(this.notifications, 'download', relPath);
        return;
      }
      
      // Clear ignored conflict
      clearIgnoredConflictIfResolved(this.state, workspaceId, relPath);
    });
    
    setTimeout(() => this.inFlightOps.delete(queueKey), 100);
  }

  // ==========================================================================
  // EXTERNAL FILE CHANGES (FileSystemWatcher - update local snapshot only)
  // ==========================================================================

  private async onExternalCreate(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }
    if (this.inFlightOps.has(key)) {
      return; // Skip - internal operation in progress
    }

    try {
      await updateLocalSnapshot(this.state, workspaceId, relPath, uri);
    } catch (err) {
      logExpectedError(`externalCreate:${relPath}`, err);
    }
  }

  private async onExternalChange(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    if (this.inFlightOps.has(key)) {
      return;
    }

    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    try {
      await updateLocalSnapshot(this.state, workspaceId, relPath, uri);
    } catch (err) {
      logExpectedError(`externalChange:${relPath}`, err);
    }
  }

  private async onExternalDelete(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    if (this.inFlightOps.has(key)) {
      return;
    }

    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    this.state.applyLocal({
      workspaceId,
      type: 'delete',
      path: relPath
    });
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Pre-flight checks before remote operations (for event handlers)
   * Returns policy if all checks pass, null if operation should be cancelled
   */
  private async shouldProceedWithEvent(
    workspaceId: WorkspaceId,
    relPath: RelPath,
    policyField: 'actionOnSave' | 'actionOnCreate' | 'actionOnDelete' | 'actionOnMove' | 'actionOnOpen'
  ): Promise<ActionPolicy | null> {
    // 1. Check if conflict already ignored
    if (hasIgnoredConflict(this.state, workspaceId, relPath)) {
      return null;
    }
    
    // 2. Check ignore patterns
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return null;
    }
    
    // 3. Get config and parse policy
    const config = await this.config.getById(workspaceId);
    const policy = parseActionPolicy(config.data[policyField]);
    
    // 4. No-op policy?
    if (isNoOpPolicy(policy)) {
      return null;
    }
    
    // 5. Config validity check (AFTER policy check - "none" policies don't need valid config)
    const validationResult = await this.validator.getCached(workspaceId);
    if (!validationResult.isValid) {
      return null;
    }
    
    return policy;
  }

  /**
   * Process array of files from VSCode events
   */
  private async processFileArray(
    files: readonly vscode.Uri[],
    handler: (info: { workspaceId: WorkspaceId; relPath: RelPath; uri: vscode.Uri }) => Promise<void>
  ): Promise<void> {
    await Promise.all(files.map(async (uri) => {
      const info = this.getWorkspaceInfo(uri);
      if (!info) {return;}
      await handler({ ...info, uri });
    }));
  }

  /**
   * Get workspace info for a file
   */
  private getWorkspaceInfo(uri: vscode.Uri): { workspaceId: WorkspaceId; relPath: RelPath } | null {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {return null;}

    const workspaceId = stringToWsId(folder.uri.fsPath);
    const relPath = relFromAbs(workspaceId, uri.fsPath);

    return { workspaceId, relPath };
  }

  /**
   * Check if file should be ignored based on ignore patterns
   */
  private async shouldIgnore(workspaceId: WorkspaceId, relPath: RelPath): Promise<boolean> {
    const config = await this.config.getById(workspaceId);
    return config.ignoreFilter.shouldIgnore(relPath as string);
  }
}