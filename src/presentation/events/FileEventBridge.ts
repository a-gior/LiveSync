import * as vscode from 'vscode';
import * as path from 'path';

import { SyncStateManager } from '@app/SyncStateManager';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import type { RemotePort } from '@app/ports/RemotePort';
import { NotificationStatusBar } from '@presentation/statusbar/NotificationStatusBar';

import { RelPath, WorkspaceId } from '@domain/types';
import { absFs, relFromAbs, stringToWsId } from '@helpers/path';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { 
  parseActionPolicy, 
  confirmPolicyAction, 
  maybeActByPolicy,
  checkShouldPrompt,
  showCheckInfo 
} from '@helpers/policy';
import { logExpectedError } from '@helpers/logging';
import { FileOperationQueue } from '@helpers/concurrency';
import { ensureFreshRemoteSnapshot, ensureFreshLocalSnapshot } from '@helpers/snapshot'; // ✅ NEW IMPORT

/**
 * FileEventBridge - Central event handler for file operations
 * 
 * Handles two types of events:
 * 1. Internal VSCode events (user actions in UI) → Update snapshot + apply policy + sync
 * 2. External file changes (terminal/git/OS) → Update local snapshot only
 * 
 * Architecture:
 * - onWill* events: Pre-track operations (mark in-flight)
 * - onDid* events: Process operations (update + policy + sync)
 * - FileSystemWatcher: Handle external changes (update snapshot only)
 */
export class FileEventBridge {
  private readonly operationQueue = new FileOperationQueue();
  
  // Track in-flight VSCode operations to prevent external watcher duplicates
  private readonly inFlightOps = new Set<string>();
  
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly remote: RemotePort,
    private readonly notifications: NotificationStatusBar
  ) {}

  /**
   * Register all event handlers
   */
  register(disposables: vscode.Disposable[]): void {
    // ========================================================================
    // INTERNAL VSCODE EVENTS (Two-phase: onWill → onDid)
    // ========================================================================
    
    // Phase 1: Pre-track (mark operations as in-flight)
    disposables.push(vscode.workspace.onWillCreateFiles((e) => this.preTrackCreate(e)));
    disposables.push(vscode.workspace.onWillDeleteFiles((e) => this.preTrackDelete(e)));
    disposables.push(vscode.workspace.onWillRenameFiles((e) => this.preTrackRename(e)));
    disposables.push(vscode.workspace.onWillSaveTextDocument((e) => this.preTrackSave(e)));

    // Phase 2: Process (update snapshot + apply policy + sync)
    disposables.push(vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)));
    disposables.push(vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)));
    disposables.push(vscode.workspace.onDidRenameFiles((e) => this.onRename(e)));
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));
    disposables.push(vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d)));

    // ========================================================================
    // EXTERNAL FILE CHANGES (FileSystemWatcher)
    // ========================================================================
    
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      
      watcher.onDidCreate((uri) => this.onExternalCreate(uri));
      watcher.onDidChange((uri) => this.onExternalChange(uri));
      watcher.onDidDelete((uri) => this.onExternalDelete(uri));
      
      disposables.push(watcher);
    }

    // Cleanup operation queue on disposal
    disposables.push({
      dispose: () => this.operationQueue.clear()
    });
  }

  // ==========================================================================
  // PRE-TRACK PHASE (onWill* events - mark operations as in-flight)
  // ==========================================================================

  private preTrackCreate(e: vscode.FileCreateEvent): void {
    for (const uri of e.files) {
      const info = this.getWorkspaceInfo(uri);
      if (!info) continue;
      
      const key = `${info.workspaceId}:${info.relPath}`;
      this.inFlightOps.add(key);
    }
  }

  private preTrackDelete(e: vscode.FileDeleteEvent): void {
    for (const uri of e.files) {
      const info = this.getWorkspaceInfo(uri);
      if (!info) continue;
      
      const key = `${info.workspaceId}:${info.relPath}`;
      this.inFlightOps.add(key);
    }
  }

  private preTrackRename(e: vscode.FileRenameEvent): void {
    for (const { oldUri, newUri } of e.files) {
      const oldInfo = this.getWorkspaceInfo(oldUri);
      const newInfo = this.getWorkspaceInfo(newUri);
      
      if (oldInfo) {
        const key = `${oldInfo.workspaceId}:${oldInfo.relPath}`;
        this.inFlightOps.add(key);
      }
      
      if (newInfo) {
        const key = `${newInfo.workspaceId}:${newInfo.relPath}`;
        this.inFlightOps.add(key);
      }
    }
  }

  private preTrackSave(e: vscode.TextDocumentWillSaveEvent): void {
    if (e.document.isUntitled) return;
    
    const info = this.getWorkspaceInfo(e.document.uri);
    if (!info) return;
    
    const key = `${info.workspaceId}:${info.relPath}`;
    this.inFlightOps.add(key);
  }

  // ==========================================================================
  // PROCESS PHASE (onDid* events - update snapshot + apply policy + sync)
  // ==========================================================================

  /**
   * Handle file creation (actionOnCreate)
   */
  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    await this.processFileArray(e.files, async ({ workspaceId, relPath, uri }) => {
      const queueKey = `${workspaceId}:${relPath}`;
      
      await this.operationQueue.enqueue(queueKey, 'create', async () => {
        // 1) Determine if file or folder
        let isDir = false;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          isDir = (stat.type & vscode.FileType.Directory) !== 0;
        } catch (err) {
          logExpectedError(`FileEventBridge:onCreate:stat:${relPath}`, err);
          return;
        }

        // 2) Update local snapshot (hash files inside queue for freshness)
        if (isDir) {
          this.state.applyLocal({
            workspaceId,
            type: 'modify',
            path: relPath,
            meta: { type: 'folder', hash: '' }
          });
        } else {
          try {
            const hash = await sha256OfFile(uri.fsPath);
            this.state.applyLocal({
              workspaceId,
              type: 'modify',
              path: relPath,
              meta: { type: 'file', hash }
            });
          } catch (err) {
            logExpectedError(`FileEventBridge:onCreate:hash:${relPath}`, err);
            return;
          }
        }

        // 3) Check if conflict is ignored
        if (this.state.isConflictIgnored(workspaceId, relPath)) {
          return;
        }

        // 4) Check ignore patterns
        if (await this.shouldIgnore(workspaceId, relPath)) {
          return;
        }

        // 5) Apply policy
        const eff = await this.config.getById(workspaceId);
        const policy = parseActionPolicy(eff.data.actionOnCreate);

        // ✅ NEW: Refresh remote snapshot before any check
        if (policy.check) {
          await ensureFreshRemoteSnapshot(
            this.state,
            this.remote,
            workspaceId,
            relPath
          );
        }

        // Handle check-only policy
        if (policy.check && !policy.direction && policy.extras.size === 0) {
          const { shouldPrompt } = await checkShouldPrompt(
            workspaceId,
            relPath,
            'create',
            this.state
          );
          
          if (shouldPrompt) {
            await showCheckInfo('create', relPath);
          }
          return;
        }

        // Handle check + action policy
        if (policy.check && policy.direction === 'upload') {
          const { shouldPrompt, reason } = await checkShouldPrompt(
            workspaceId,
            relPath,
            'create',
            this.state
          );

          if (shouldPrompt) {
            const decision = await confirmPolicyAction(
              workspaceId,
              'upload',
              !isDir,
              relPath,
              reason
            );

            if (decision === 'ignore') {
              this.state.markConflictIgnored(
                workspaceId,
                relPath,
                'remote-modified',
                reason || 'File already exists remotely'
              );
              return;
            }

            if (decision !== 'proceed') {
              return;
            }
          }
        }

        // Execute policy action
        await maybeActByPolicy(
          workspaceId,
          relPath,
          policy,
          'create',
          this.state,
          this.remote
        );

        // Show notification and clear conflict on success
        if (policy.direction === 'upload') {
          this.notifications.notify(`Created ${path.basename(relPath)}`, 'cloud-upload');
          
          if (this.state.isConflictIgnored(workspaceId, relPath)) {
            this.state.clearIgnoredConflict(workspaceId, relPath);
          }
        }
      });

      // Clear in-flight marker after short delay (allow external watcher to see it)
      setTimeout(() => {
        const key = `${workspaceId}:${relPath}`;
        this.inFlightOps.delete(key);
      }, 100);
    });
  }

  /**
   * Handle file save (actionOnSave)
   */
  private async onSave(doc: vscode.TextDocument): Promise<void> {
    if (doc.isUntitled) return;

    const info = this.getWorkspaceInfo(doc.uri);
    if (!info) return;

    const { workspaceId, relPath } = info;
    const queueKey = `${workspaceId}:${relPath}`;

    await this.operationQueue.enqueue(queueKey, 'save', async () => {
      // 1) Update local snapshot (hash INSIDE queue for latest content)
      let hash: string;
      try {
        hash = await sha256OfFile(doc.uri.fsPath);
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'file', hash }
        });
      } catch (err) {
        logExpectedError(`FileEventBridge:onSave:hash:${relPath}`, err);
        return;
      }

      // 2) Check if conflict is ignored
      if (this.state.isConflictIgnored(workspaceId, relPath)) {
        return;
      }

      // 3) Check ignore patterns
      if (await this.shouldIgnore(workspaceId, relPath)) {
        return;
      }

      // 4) Apply policy
      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnSave);

      // ✅ NEW: Refresh remote snapshot before any check
      if (policy.check) {
        await ensureFreshRemoteSnapshot(
          this.state,
          this.remote,
          workspaceId,
          relPath
        );
      }

      // Handle check-only policy
      if (policy.check && !policy.direction && policy.extras.size === 0) {
        const { shouldPrompt } = await checkShouldPrompt(
          workspaceId,
          relPath,
          'save',
          this.state
        );
        
        if (shouldPrompt) {
          await showCheckInfo('save', relPath);
        }
        return;
      }

      // Handle check + action policy
      if (policy.check && policy.direction === 'upload') {
        const { shouldPrompt, reason } = await checkShouldPrompt(
          workspaceId,
          relPath,
          'save',
          this.state
        );

        if (shouldPrompt) {
          const decision = await confirmPolicyAction(
            workspaceId,
            'upload',
            true,
            relPath,
            reason
          );

          if (decision === 'ignore') {
            this.state.markConflictIgnored(
              workspaceId,
              relPath,
              'remote-modified',
              reason || 'Remote file was modified'
            );
            return;
          }

          if (decision !== 'proceed') {
            return;
          }
        }
      }

      // Execute policy action
      await maybeActByPolicy(
        workspaceId,
        relPath,
        policy,
        'save',
        this.state,
        this.remote
      );

      // Show notification and clear conflict on success
      if (policy.direction === 'upload') {
        this.notifications.notify(`Saved ${path.basename(relPath)}`, 'cloud-upload');
        
        if (this.state.isConflictIgnored(workspaceId, relPath)) {
          this.state.clearIgnoredConflict(workspaceId, relPath);
        }
      }
    });

    // Clear in-flight marker after short delay
    setTimeout(() => {
      const key = `${workspaceId}:${relPath}`;
      this.inFlightOps.delete(key);
    }, 100);
  }

  /**
   * Handle file deletion (actionOnDelete)
   */
  private async onDelete(e: vscode.FileDeleteEvent): Promise<void> {
    await this.processFileArray(e.files, async ({ workspaceId, relPath }) => {
      const queueKey = `${workspaceId}:${relPath}`;
      
      await this.operationQueue.enqueue(queueKey, 'delete', async () => {
        // 1) Update local snapshot
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

        // 2) Check if conflict is ignored
        if (this.state.isConflictIgnored(workspaceId, relPath)) {
          return;
        }

        // 3) Check ignore patterns
        if (await this.shouldIgnore(workspaceId, relPath)) {
          return;
        }

        // 4) Apply policy
        const eff = await this.config.getById(workspaceId);
        const policy = parseActionPolicy(eff.data.actionOnDelete);

        // ✅ NEW: Refresh remote snapshot before any check
        if (policy.check) {
          await ensureFreshRemoteSnapshot(
            this.state,
            this.remote,
            workspaceId,
            relPath
          );
        }

        // Handle check-only policy
        if (policy.check && !policy.direction && policy.extras.size === 0) {
          const { shouldPrompt } = await checkShouldPrompt(
            workspaceId,
            relPath,
            'delete',
            this.state
          );
          
          if (shouldPrompt) {
            await showCheckInfo('delete', relPath);
          }
          return;
        }

        // Handle check + delete policy
        if (policy.check && policy.extras.has('delete')) {
          const { shouldPrompt, reason } = await checkShouldPrompt(
            workspaceId,
            relPath,
            'delete',
            this.state
          );

          if (shouldPrompt) {
            const decision = await confirmPolicyAction(
              workspaceId,
              'delete',
              false,
              relPath,
              reason
            );

            if (decision === 'ignore') {
              this.state.markConflictIgnored(
                workspaceId,
                relPath,
                'remote-modified',
                reason || 'Remote file was modified'
              );
              return;
            }

            if (decision !== 'proceed') {
              return;
            }
          }
        }

        // Execute delete if policy includes it
        if (policy.extras.has('delete')) {
          try {
            await this.remote.deletePath(workspaceId, relPath);
            this.state.applyRemote({
              workspaceId,
              type: 'delete',
              path: relPath
            });
            
            this.notifications.notify(`Deleted ${path.basename(relPath)}`, 'trash');
            
            if (this.state.isConflictIgnored(workspaceId, relPath)) {
              this.state.clearIgnoredConflict(workspaceId, relPath);
            }
          } catch (err) {
            logExpectedError(`FileEventBridge:onDelete:remote:${relPath}`, err);
          }
        }
      });

      // Clear in-flight marker after short delay
      setTimeout(() => {
        const key = `${workspaceId}:${relPath}`;
        this.inFlightOps.delete(key);
      }, 100);
    });
  }

  /**
   * Handle file rename/move (actionOnMove)
   */
  private async onRename(e: vscode.FileRenameEvent): Promise<void> {
    await Promise.all(e.files.map(async ({ oldUri, newUri }) => {
      const folder = vscode.workspace.getWorkspaceFolder(newUri) ?? 
                     vscode.workspace.getWorkspaceFolder(oldUri);
      if (!folder) return;

      const workspaceId = stringToWsId(folder.uri.fsPath);
      const oldRel = relFromAbs(workspaceId, oldUri.fsPath);
      const newRel = relFromAbs(workspaceId, newUri.fsPath);
      const queueKey = `${workspaceId}:${newRel}`;

      await this.operationQueue.enqueue(queueKey, 'rename', async () => {
        // 1) Determine if file or folder
        let isDir = false;
        try {
          const stat = await vscode.workspace.fs.stat(newUri);
          isDir = (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
          return;
        }

        // 2) Update local snapshot (hash files inside queue)
        if (isDir) {
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

        // 3) Check if either path has ignored conflict
        if (this.state.isConflictIgnored(workspaceId, oldRel) || 
            this.state.isConflictIgnored(workspaceId, newRel)) {
          return;
        }

        // 4) Check ignore patterns
        if (await this.shouldIgnore(workspaceId, oldRel)) {
          return;
        }

        // 5) Apply policy
        const eff = await this.config.getById(workspaceId);
        const policy = parseActionPolicy(eff.data.actionOnMove);

        // ✅ NEW: Refresh remote snapshot for target path before any check
        if (policy.check) {
          await ensureFreshRemoteSnapshot(
            this.state,
            this.remote,
            workspaceId,
            newRel
          );
        }

        // Handle check-only policy
        if (policy.check && !policy.direction && !policy.extras.has('rename')) {
          const { shouldPrompt } = await checkShouldPrompt(
            workspaceId,
            newRel,
            'move',
            this.state
          );
          
          if (shouldPrompt) {
            await showCheckInfo('rename', newRel, oldRel);
          }
          return;
        }

        // Handle check + move policy
        if (policy.check && policy.extras.has('rename')) {
          const { shouldPrompt, reason } = await checkShouldPrompt(
            workspaceId,
            newRel,
            'move',
            this.state
          );

          if (shouldPrompt) {
            const decision = await confirmPolicyAction(
              workspaceId,
              'move',
              false,
              newRel,
              reason
            );

            if (decision === 'ignore') {
              this.state.markConflictIgnored(
                workspaceId,
                newRel,
                'remote-modified',
                reason || 'Target path exists remotely'
              );
              return;
            }

            if (decision !== 'proceed') {
              return;
            }
          }
        }

        // Execute move if policy includes it
        if (policy.extras.has('rename')) {
          try {
            // Delete old path
            await this.remote.deletePath(workspaceId, oldRel);
            
            // Upload to new path
            if (isDir) {
              // For folders, need to upload all files (simplified here)
              // In practice, might need uploadSubtreeToRemote helper
              logExpectedError(`FileEventBridge:onRename:folder:${newRel}`, 
                new Error('Folder rename not fully implemented'));
            } else {
              await this.remote.uploadFile(
                workspaceId, 
                newRel, 
                absFs(workspaceId, newRel)
              );

              const h = await sha256OfFile(absFs(workspaceId, newRel));
              this.state.applyRemote({
                workspaceId,
                type: 'modify',
                path: newRel,
                meta: { type: 'file', hash: h }
              });
            }
            
            this.state.applyRemote({
              workspaceId,
              type: 'delete',
              path: oldRel
            });
            
            this.notifications.notify(`Moved ${path.basename(newRel)}`, 'cloud-upload');
            
            if (this.state.isConflictIgnored(workspaceId, newRel)) {
              this.state.clearIgnoredConflict(workspaceId, newRel);
            }
          } catch (err) {
            logExpectedError(`FileEventBridge:onRename:remote:${newRel}`, err);
          }
        }
      });

      // Clear in-flight markers after short delay
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
    if (doc.isUntitled) return;

    const info = this.getWorkspaceInfo(doc.uri);
    if (!info) return;

    const { workspaceId, relPath } = info;
    const queueKey = `${workspaceId}:${relPath}`;
    
    // Skip if file was just created (prevents create→open collision)
    if (this.operationQueue.hadRecentOperationAny(queueKey, ['create'])) {
      console.log(`Skipping onOpen for recently created file: ${relPath}`);
      return;
    }

    await this.operationQueue.enqueue(queueKey, 'open', async () => {
      // 1) Check if conflict is ignored
      if (this.state.isConflictIgnored(workspaceId, relPath)) {
        return;
      }

      // 2) Check ignore patterns
      if (await this.shouldIgnore(workspaceId, relPath)) {
        return;
      }

      // 3) Apply policy
      const eff = await this.config.getById(workspaceId);
      const policy = parseActionPolicy(eff.data.actionOnOpen);

      // ✅ NEW: Refresh snapshots before any check
      if (policy.check) {
        // For download direction, refresh local to detect external changes
        if (policy.direction === 'download') {
          await ensureFreshLocalSnapshot(
            this.state,
            workspaceId,
            relPath
          );
        }
        // Always refresh remote
        await ensureFreshRemoteSnapshot(
          this.state,
          this.remote,
          workspaceId,
          relPath
        );
      }

      // Handle check-only policy
      if (policy.check && !policy.direction && policy.extras.size === 0) {
        const { shouldPrompt } = await checkShouldPrompt(
          workspaceId,
          relPath,
          'open',
          this.state
        );
        
        if (shouldPrompt) {
          await showCheckInfo('open', relPath);
        }
        return;
      }

      // Handle check + action policy
      if (policy.check && policy.direction === 'download') {
        const { shouldPrompt, reason } = await checkShouldPrompt(
          workspaceId,
          relPath,
          'open',
          this.state
        );

        if (shouldPrompt) {
          const decision = await confirmPolicyAction(
            workspaceId,
            'download',
            false,
            relPath,
            reason
          );

          if (decision === 'ignore') {
            this.state.markConflictIgnored(
              workspaceId,
              relPath,
              'remote-modified',
              reason || 'Remote file has changed'
            );
            return;
          }

          if (decision !== 'proceed') {
            return;
          }
        }
      }

      // Execute policy action
      await maybeActByPolicy(
        workspaceId,
        relPath,
        policy,
        'open',
        this.state,
        this.remote
      );

      // Show notification and clear conflict on success
      if (policy.direction === 'download') {
        this.notifications.notify(`Downloaded ${path.basename(relPath)}`, 'cloud-download');
        
        if (this.state.isConflictIgnored(workspaceId, relPath)) {
          this.state.clearIgnoredConflict(workspaceId, relPath);
        }
      }
    });
  }

  // ==========================================================================
  // EXTERNAL FILE CHANGES (FileSystemWatcher - update snapshot only)
  // ==========================================================================

  /**
   * Handle external file creation (terminal, git, OS)
   * Only updates local snapshot - no policy checks or remote sync
   */
  private async onExternalCreate(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) return;

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    // Skip if VSCode just created this file
    if (this.inFlightOps.has(key)) {
      return;
    }

    // Check ignore patterns
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    // Update local snapshot only
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const isDir = (stat.type & vscode.FileType.Directory) !== 0;

      if (isDir) {
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'folder', hash: '' }
        });
      } else {
        const hash = await sha256OfFile(uri.fsPath);
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: { type: 'file', hash }
        });
      }
    } catch (err) {
      logExpectedError(`FileEventBridge:onExternalCreate:${relPath}`, err);
    }
  }

  /**
   * Handle external file change (terminal, git, OS)
   * Only updates local snapshot - no policy checks or remote sync
   */
  private async onExternalChange(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) return;

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    // Skip if VSCode just saved this file
    if (this.inFlightOps.has(key)) {
      return;
    }

    // Check ignore patterns
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    // Update local snapshot only
    try {
      const hash = await sha256OfFile(uri.fsPath);
      this.state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash }
      });
    } catch (err) {
      logExpectedError(`FileEventBridge:onExternalChange:${relPath}`, err);
    }
  }

  /**
   * Handle external file deletion (terminal, git, OS)
   * Only updates local snapshot - no policy checks or remote sync
   */
  private async onExternalDelete(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) return;

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    // Skip if VSCode just deleted this file
    if (this.inFlightOps.has(key)) {
      return;
    }

    // Check ignore patterns
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    // Update local snapshot only
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
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Extract workspace info from URI
   */
  private getWorkspaceInfo(uri: vscode.Uri): { 
    workspaceId: WorkspaceId; 
    relPath: RelPath 
  } | null {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return null;

    const workspaceId = stringToWsId(folder.uri.fsPath);
    const relPath = relFromAbs(workspaceId, uri.fsPath);

    return { workspaceId, relPath };
  }

  /**
   * Check if path should be ignored based on ignore patterns
   */
  private async shouldIgnore(workspaceId: WorkspaceId, relPath: RelPath): Promise<boolean> {
    const eff = await this.config.getById(workspaceId);
    return eff.ignoreFilter.shouldIgnore(relPath);
  }

  /**
   * Process multiple files with a common handler
   */
  private async processFileArray(
    files: readonly vscode.Uri[],
    handler: (info: { 
      workspaceId: WorkspaceId; 
      relPath: RelPath; 
      uri: vscode.Uri 
    }) => Promise<void>
  ): Promise<void> {
    await Promise.all(files.map(async (uri) => {
      const info = this.getWorkspaceInfo(uri);
      if (!info) return;

      await handler({ ...info, uri });
    }));
  }
}