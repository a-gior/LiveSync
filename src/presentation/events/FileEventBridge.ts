/**
 * FileEventBridge - Event Handler for File Operations
 * 
 * Handles VS Code file events and delegates to unified action handler.
 * Uses the new handleAction() function for consistent conflict handling.
 */

import * as vscode from 'vscode';

import { SyncStateManager } from '@app/SyncStateManager';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import type { RemotePort } from '@app/ports/RemotePort';
import { NotificationStatusBar } from '@presentation/statusbar/NotificationStatusBar';
import type { ExperimentalTreeProvider } from '@presentation/tree/ExperimentalTreeProvider';

import type { RelPath, WorkspaceId, NodeMeta } from '@domain/types';
import { relFromAbs, stringToWsId } from '@helpers/path';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';
import { FileOperationQueue } from '@helpers/concurrency';
import { handleAction } from '@helpers/action/handler';

/**
 * FileEventBridge - Central event handler for file operations
 */
export class FileEventBridge {
  private readonly operationQueue = new FileOperationQueue();
  private readonly inFlightOps = new Set<string>();
  
  constructor(
    private readonly state: SyncStateManager,
    private readonly config: WorkspaceConfigService,
    private readonly validator: ConfigValidator,
    private readonly remote: RemotePort,
    private readonly notifications: NotificationStatusBar,
    private readonly provider: ExperimentalTreeProvider
  ) {}

  /**
   * Register all event handlers
   */
  register(disposables: vscode.Disposable[]): void {
    // Internal VSCode events
    disposables.push(vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)));
    disposables.push(vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)));
    disposables.push(vscode.workspace.onDidRenameFiles((e) => this.onRename(e)));
    disposables.push(vscode.workspace.onDidSaveTextDocument((d) => this.onSave(d)));
    disposables.push(vscode.workspace.onDidOpenTextDocument((d) => this.onOpen(d)));
  }

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

  /**
   * Handle file creation (actionOnCreate)
   */
  private async onCreate(e: vscode.FileCreateEvent): Promise<void> {
    await Promise.all(e.files.map(async (uri) => {
      const info = this.getWorkspaceInfo(uri);
      if (!info) {return;}

      const { workspaceId, relPath } = info;
      const queueKey = `${workspaceId}:${relPath}`;
      
      // Prevent duplicate processing
      if (this.inFlightOps.has(queueKey)) {return;}
      this.inFlightOps.add(queueKey);

      await this.operationQueue.enqueue(queueKey, 'create', async () => {
        // Capture old metas (undefined for new file)
        const oldLocalMeta = this.state.getLocalMeta(workspaceId, relPath);
        const oldRemoteMeta = this.state.getRemoteMeta(workspaceId, relPath);
        
        // Update local snapshot (file already created)
        let actualLocalMeta: NodeMeta | undefined;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          const isDir = (stat.type & vscode.FileType.Directory) !== 0;
          
          if (isDir) {
            actualLocalMeta = { type: 'folder', hash: '' };
            this.state.applyLocal({
              workspaceId,
              type: 'create',
              path: relPath,
              meta: actualLocalMeta
            });
          } else {
            const hash = await sha256OfFile(uri.fsPath);
            actualLocalMeta = { type: 'file', hash };
            this.state.applyLocal({
              workspaceId,
              type: 'create',
              path: relPath,
              meta: actualLocalMeta
            });
          }
        } catch (err) {
          logExpectedError(`onCreate:updateSnapshot:${relPath}`, err);
          return;
        }
        
        // Call unified handler
        await handleAction({
          workspaceId,
          relPath,
          policyKey: 'actionOnCreate',
          operation: 'create',
          actualMetas: {
            local: actualLocalMeta,
            remote: undefined  // Fetched inside handleAction if needed
          },
          oldMetas: {
            local: oldLocalMeta,
            remote: oldRemoteMeta
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
      
      setTimeout(() => this.inFlightOps.delete(queueKey), 100);
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
      // Capture old metas
      const oldLocalMeta = this.state.getLocalMeta(workspaceId, relPath);
      const oldRemoteMeta = this.state.getRemoteMeta(workspaceId, relPath);
      
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
      
      // Call unified handler
      await handleAction({
        workspaceId,
        relPath,
        policyKey: 'actionOnSave',
        operation: 'save',
        actualMetas: {
          local: actualLocalMeta,
          remote: undefined  // Fetched inside handleAction if needed
        },
        oldMetas: {
          local: oldLocalMeta,
          remote: oldRemoteMeta
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
      
      // Prevent duplicate processing
      if (this.inFlightOps.has(queueKey)) {return;}
      this.inFlightOps.add(queueKey);

      await this.operationQueue.enqueue(queueKey, 'delete', async () => {
        // Capture old metas (file metadata before deletion)
        const oldLocalMeta = this.state.getLocalMeta(workspaceId, relPath);
        const oldRemoteMeta = this.state.getRemoteMeta(workspaceId, relPath);
        
        // Update local snapshot (file already deleted)
        this.state.applyLocal({
          workspaceId,
          type: 'delete',
          path: relPath
        });
        
        // Call unified handler
        await handleAction({
          workspaceId,
          relPath,
          policyKey: 'actionOnDelete',
          operation: 'delete',
          actualMetas: {
            local: undefined,  // File deleted
            remote: undefined  // Fetched inside handleAction if needed
          },
          oldMetas: {
            local: oldLocalMeta,
            remote: oldRemoteMeta
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
      
      setTimeout(() => this.inFlightOps.delete(queueKey), 100);
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
        // Capture old metas (before move)
        const oldLocalMeta = this.state.getLocalMeta(workspaceId, oldRel);
        const oldRemoteMeta = this.state.getRemoteMeta(workspaceId, oldRel);
        
        // Update local snapshot (file already moved)
        let actualLocalMeta: NodeMeta | undefined;
        try {
          const stat = await vscode.workspace.fs.stat(newUri);
          const isDir = (stat.type & vscode.FileType.Directory) !== 0;
          
          if (isDir) {
            actualLocalMeta = { type: 'folder', hash: '' };
            this.state.applyLocal({
              workspaceId,
              type: 'move',
              path: oldRel,
              newPath: newRel,
              meta: actualLocalMeta
            });
          } else {
            const hash = await sha256OfFile(newUri.fsPath);
            actualLocalMeta = { type: 'file', hash };
            this.state.applyLocal({
              workspaceId,
              type: 'move',
              path: oldRel,
              newPath: newRel,
              meta: actualLocalMeta
            });
          }
        } catch (err) {
          logExpectedError(`onRename:updateSnapshot:${newRel}`, err);
          return;
        }
        
        // Call unified handler
        await handleAction({
          workspaceId,
          relPath: newRel,
          oldPath: oldRel,
          policyKey: 'actionOnMove',
          operation: 'move',
          actualMetas: {
            local: actualLocalMeta,
            remote: undefined  // Fetched inside handleAction if needed
          },
          oldMetas: {
            local: oldLocalMeta,
            remote: oldRemoteMeta
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
    
    // Skip if file was just created or moved (prevents create→open collision)
    if (this.operationQueue.hadRecentOperationAny(queueKey, ['create', 'move'])) {
      console.log(`onOpen: Skipping for recently created/moved file: ${relPath}`);
      return;
    }

    await this.operationQueue.enqueue(queueKey, 'open', async () => {
      // Capture old metas
      const oldLocalMeta = this.state.getLocalMeta(workspaceId, relPath);
      const oldRemoteMeta = this.state.getRemoteMeta(workspaceId, relPath);
      
      // Get current local meta
      let actualLocalMeta: NodeMeta | undefined;
      try {
        const hash = await sha256OfFile(doc.uri.fsPath);
        actualLocalMeta = { type: 'file', hash };
      } catch (err) {
        logExpectedError(`onOpen:getLocalMeta:${relPath}`, err);
        return;
      }
      
      // Call unified handler
      await handleAction({
        workspaceId,
        relPath,
        policyKey: 'actionOnOpen',
        operation: 'open',
        actualMetas: {
          local: actualLocalMeta,
          remote: undefined  // Fetched inside handleAction if needed
        },
        oldMetas: {
          local: oldLocalMeta,
          remote: oldRemoteMeta
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
  }
}