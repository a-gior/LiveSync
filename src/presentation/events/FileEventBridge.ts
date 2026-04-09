/**
 * FileEventBridge - Event Handler for File Operations
 * 
 * Handles two types of events:
 * 1. Internal VSCode events (user actions in UI) → Update snapshot + apply policy + sync
 * 2. External file changes (terminal/git/OS) → Update local snapshot only
 * 
 * Uses two-phase tracking (onWill + onDid) to prevent duplicate processing.
 * 
 * UPDATED for 3-way merge: No longer captures oldMetas - baseMeta fetched inside handleAction
 */

import * as vscode from 'vscode';

import { SyncStateManager } from '@app/SyncStateManager';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import type { RemotePort } from '@app/ports/RemotePort';
import { NotificationStatusBar } from '@presentation/statusbar/NotificationStatusBar';
import type { SyncStateTreeProvider } from '@presentation/tree/SyncStateTreeProvider';

import type { RelPath, WorkspaceId, NodeMeta } from '@domain/types';
import { relFromAbs, stringToWsId } from '@helpers/path';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';
import { fileOperationQueue } from '@helpers/concurrency';
import { handleAction } from '@helpers/action/handler';
import { updateLocalSnapshot } from '@helpers/snapshot/update';

/**
 * FileEventBridge - Central event handler for file operations
 */
export class FileEventBridge {
  private readonly operationQueue = fileOperationQueue;
  private readonly inFlightOps = new Set<string>();
  
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly validator: ConfigValidator,
    private readonly remote: RemotePort,
    private readonly notifications: NotificationStatusBar,
    private readonly provider: SyncStateTreeProvider
  ) {}

  /**
   * Register all event handlers
   */
  register(disposables: vscode.Disposable[]): void {
    // ========================================================================
    // PHASE 1: Pre-tracking (onWill* - mark operations as in-flight)
    // ========================================================================
    disposables.push(vscode.workspace.onWillCreateFiles((e) => this.preTrackCreate(e)));
    disposables.push(vscode.workspace.onWillDeleteFiles((e) => this.preTrackDelete(e)));
    disposables.push(vscode.workspace.onWillRenameFiles((e) => this.preTrackRename(e)));
    disposables.push(vscode.workspace.onWillSaveTextDocument((e) => this.preTrackSave(e)));

    // ========================================================================
    // PHASE 2: Processing (onDid* - update snapshot + apply policy + sync)
    // ========================================================================
    disposables.push(vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)));
    disposables.push(vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)));
    disposables.push(vscode.workspace.onDidRenameFiles((e) => this.onRename(e)));
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));
    disposables.push(vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d)));

    // ========================================================================
    // PHASE 3: External file changes (FileSystemWatcher)
    // ========================================================================
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
  // PROCESS PHASE (onDid* - handle with unified action handler)
  // ==========================================================================

  /**
   * Handle file creation (actionOnCreate)
   */
  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    await Promise.all(e.files.map(async (uri) => {
      const info = this.getWorkspaceInfo(uri);
      if (!info) {return;}

      const { workspaceId, relPath } = info;
      const queueKey = `${workspaceId}:${relPath}`;
      
      await this.operationQueue.enqueue(queueKey, 'create', async () => {
        // Update local snapshot (file already created)
        let actualLocalMeta: NodeMeta | undefined;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          const isDir = (stat.type & vscode.FileType.Directory) !== 0;
          
          if (isDir) {
            actualLocalMeta = { type: 'folder', hash: '' };
          } else {
            const hash = await sha256OfFile(uri.fsPath);
            actualLocalMeta = { type: 'file', hash };
          }
          
          this.state.applyLocal({
            workspaceId,
            type: 'modify',
            path: relPath,
            meta: actualLocalMeta
          });
        } catch (err) {
          logExpectedError(`onCreate:updateSnapshot:${relPath}`, err);
          return;
        }
        
        // Call unified handler (baseMeta fetched inside)
        await handleAction({
          workspaceId,
          relPath,
          policyKey: 'actionOnCreate',
          operation: 'create',
          actualMetas: {
            local: actualLocalMeta,
            remote: undefined  // Fetched inside handleAction
          },
          isCommand: false,
          
          // Services
          state: this.state,
          config: this.config,
          validator: this.validator,
          remote: this.remote,
          notifications: this.notifications,
          provider: this.provider,
          shouldIgnore: this.shouldIgnore.bind(this)
        });
      });
      
      setTimeout(() => this.inFlightOps.delete(queueKey), 500);
    }));
  }

  /**
   * Handle file deletion (actionOnDelete)
   */
  private async onDelete(e: vscode.FileDeleteEvent): Promise<void> {
    await Promise.all(e.files.map(async (uri) => {
      const info = this.getWorkspaceInfo(uri);
      if (!info) {return;}

      const { workspaceId, relPath } = info;
      const queueKey = `${workspaceId}:${relPath}`;
      
      await this.operationQueue.enqueue(queueKey, 'delete', async () => {
        // Update local snapshot (file already deleted)
        this.state.applyLocal({
          workspaceId,
          type: 'delete',
          path: relPath
        });
        
        // Call unified handler (baseMeta fetched inside)
        await handleAction({
          workspaceId,
          relPath,
          policyKey: 'actionOnDelete',
          operation: 'delete',
          actualMetas: {
            local: undefined,  // File deleted
            remote: undefined  // Fetched inside handleAction
          },
          isCommand: false,
          
          // Services
          state: this.state,
          config: this.config,
          validator: this.validator,
          remote: this.remote,
          notifications: this.notifications,
          provider: this.provider,
          shouldIgnore: this.shouldIgnore.bind(this)
        });
      });
      
      setTimeout(() => this.inFlightOps.delete(queueKey), 500);
    }));
  }

  /**
   * Handle file move/rename (actionOnMove)
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
        // Update local snapshot (file already moved)
        let actualLocalMeta: NodeMeta | undefined;
        try {
          const stat = await vscode.workspace.fs.stat(newUri);
          const isDir = (stat.type & vscode.FileType.Directory) !== 0;
          
          if (isDir) {
            actualLocalMeta = { type: 'folder', hash: '' };
          } else {
            const hash = await sha256OfFile(newUri.fsPath);
            actualLocalMeta = { type: 'file', hash };
          }
          
          this.state.applyLocal({
            workspaceId,
            type: 'move',
            path: oldRel,
            newPath: newRel
          });
        } catch (err) {
          logExpectedError(`onRename:updateSnapshot:${newRel}`, err);
          return;
        }
        
        // Call unified handler (baseMeta fetched inside)
        await handleAction({
          workspaceId,
          relPath: newRel,
          oldPath: oldRel,
          policyKey: 'actionOnMove',
          operation: 'move',
          actualMetas: {
            local: actualLocalMeta,
            remote: undefined  // Fetched inside handleAction
          },
          isCommand: false,
          
          // Services
          state: this.state,
          config: this.config,
          validator: this.validator,
          remote: this.remote,
          notifications: this.notifications,
          provider: this.provider,
          shouldIgnore: this.shouldIgnore.bind(this)
        });
      });
      
      setTimeout(() => {
        this.inFlightOps.delete(`${workspaceId}:${oldRel}`);
        this.inFlightOps.delete(`${workspaceId}:${newRel}`);
      }, 500);
    }));
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
      // Update local snapshot (file already saved)
      let actualLocalMeta: NodeMeta | undefined;
      try {
        const hash = await sha256OfFile(doc.uri.fsPath);
        actualLocalMeta = { type: 'file', hash };
        
        this.state.applyLocal({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: actualLocalMeta
        });
      } catch (err) {
        logExpectedError(`onSave:updateSnapshot:${relPath}`, err);
        return;
      }
      
      // Call unified handler (baseMeta fetched inside)
      await handleAction({
        workspaceId,
        relPath,
        policyKey: 'actionOnSave',
        operation: 'save',
        actualMetas: {
          local: actualLocalMeta,
          remote: undefined  // Fetched inside handleAction
        },
        isCommand: false,
        
        // Services
        state: this.state,
        config: this.config,
        validator: this.validator,
        remote: this.remote,
        notifications: this.notifications,
        provider: this.provider,
        shouldIgnore: this.shouldIgnore.bind(this)
      });
    });
    
    setTimeout(() => this.inFlightOps.delete(queueKey), 500);
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
    
    // Small delay to allow any rename event to register first
    await new Promise(resolve => setTimeout(resolve, 50));

    // Skip if file was just created or moved (prevents create→open collision)
    if (this.operationQueue.hadRecentOperationAny(queueKey, ['create', 'move'])) {
      console.log(`onOpen: Skipping for recently created/moved file: ${relPath}`);
      return;
    }

    await this.operationQueue.enqueue(queueKey, 'open', async () => {
      // Get current local meta
      let actualLocalMeta: NodeMeta | undefined;
      try {
        const hash = await sha256OfFile(doc.uri.fsPath);
        actualLocalMeta = { type: 'file', hash };
      } catch (err) {
        logExpectedError(`onOpen:getLocalMeta:${relPath}`, err);
        return;
      }
      
      // Call unified handler (baseMeta fetched inside)
      await handleAction({
        workspaceId,
        relPath,
        policyKey: 'actionOnOpen',
        operation: 'open',
        actualMetas: {
          local: actualLocalMeta,
          remote: undefined  // Fetched inside handleAction
        },
        isCommand: false,
        
        // Services
        state: this.state,
        config: this.config,
        validator: this.validator,
        remote: this.remote,
        notifications: this.notifications,
        provider: this.provider,
        shouldIgnore: this.shouldIgnore.bind(this)
      });
    });
    
    setTimeout(() => this.inFlightOps.delete(queueKey), 500);
  }

  // ==========================================================================
  // EXTERNAL FILE CHANGES (FileSystemWatcher - update local snapshot only)
  // ==========================================================================

  /**
   * Handle external file creation (e.g., terminal, git, OS)
   * Only updates local snapshot, does NOT trigger sync
   */
  private async onExternalCreate(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    // Skip if internal operation in progress
    if (this.inFlightOps.has(key)) {
      return;
    }

    // Skip ignored files
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    try {
      await updateLocalSnapshot(this.state, workspaceId, relPath, uri);
      this.provider.refresh(); // Update UI
    } catch (err) {
      logExpectedError(`externalCreate:${relPath}`, err);
    }
  }

  /**
   * Handle external file change (e.g., build tool, external editor)
   * Only updates local snapshot, does NOT trigger sync
   */
  private async onExternalChange(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    // Skip if internal operation in progress
    if (this.inFlightOps.has(key)) {
      return;
    }

    // Skip ignored files
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    try {
      await updateLocalSnapshot(this.state, workspaceId, relPath, uri);
      this.provider.refresh(); // Update UI
    } catch (err) {
      logExpectedError(`externalChange:${relPath}`, err);
    }
  }

  /**
   * Handle external file deletion (e.g., rm command, git clean)
   * Only updates local snapshot, does NOT trigger sync
   */
  private async onExternalDelete(uri: vscode.Uri): Promise<void> {
    const info = this.getWorkspaceInfo(uri);
    if (!info) {return;}

    const { workspaceId, relPath } = info;
    const key = `${workspaceId}:${relPath}`;

    // Skip if internal operation in progress
    if (this.inFlightOps.has(key)) {
      return;
    }

    // Skip ignored files
    if (await this.shouldIgnore(workspaceId, relPath)) {
      return;
    }

    this.state.applyLocal({
      workspaceId,
      type: 'delete',
      path: relPath
    });
    
    this.provider.refresh(); // Update UI
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Get workspace info for a URI
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
    const cfg = await this.config.getById(workspaceId);
    return cfg.ignoreFilter.shouldIgnore(relPath as string);
  }
}