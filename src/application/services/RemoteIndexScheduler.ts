/**
 * Remote Index Scheduler
 * 
 * Manages periodic remote index refresh for all configured workspaces.
 * Uses staggered intervals to avoid simultaneous refreshes.
 */

import * as vscode from 'vscode';
import type { WorkspaceId } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import type { ConfigValidator } from '@infra/config/ConfigValidator';
import type { RemotePort } from '@app/ports/RemotePort';
import type { NotificationStatusBar } from '@presentation/statusbar/NotificationStatusBar';
import type { SyncStateTreeProvider } from '@presentation/tree/SyncStateTreeProvider';
import { workspaceOperationQueue } from '@helpers/concurrency/WorkspaceOperationQueue';
import { findWorkspaceFolderById, getWorkspaceIds } from '@helpers/workspaceFolder';
import { logInfoMessage, logExpectedError } from '@helpers/logging';
import { stringToWsId } from '../../infrastructure/helpers/path';

interface SchedulerDeps {
  state: SyncStateManager;
  config: WorkspaceConfigService;
  validator: ConfigValidator;
  remote: RemotePort;
  notifications: NotificationStatusBar;
  provider: SyncStateTreeProvider;
}

export class RemoteIndexScheduler implements vscode.Disposable {
  private readonly timers = new Map<WorkspaceId, NodeJS.Timeout>();
  private readonly deps: SchedulerDeps;
  private configListener: vscode.Disposable | undefined;
  private isDisposed = false;
  private workspaceFolderListener: vscode.Disposable | undefined;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
    this.startConfigListener();
    this.startWorkspaceFolderListener();
    this.initializeTimers();
  }

  /**
   * Listen for config changes to restart timers
   */
  private startConfigListener(): void {
    this.configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('livesync.remoteIndex.autoRefreshInterval')) {
        this.restartAllTimers();
      }
    });
  }

  private startWorkspaceFolderListener(): void {
    this.workspaceFolderListener = vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      // Stop timers for removed folders
      for (const removed of event.removed) {
        const wsId = stringToWsId(removed.uri.fsPath);
        this.stopTimerForWorkspace(wsId);
        logInfoMessage(`[RemoteIndexScheduler] Stopped timer for removed workspace: ${removed.name}`);
      }

      // Start timers for added folders (with stagger)
      for (let i = 0; i < event.added.length; i++) {
        const added = event.added[i];
        const wsId = stringToWsId(added.uri.fsPath);
        
        // Stagger new workspace timers
        setTimeout(() => {
          if (!this.isDisposed) {
            void this.startTimerForWorkspace(wsId);
          }
        }, i * 5000);
      }
    });
  }

  /**
   * Initialize timers for all workspaces with staggered start
   */
  private initializeTimers(): void {
    const workspaceIds = getWorkspaceIds();
    const staggerMs = 5000; // 5 seconds between each workspace start

    workspaceIds.forEach((wsId, index) => {
      // Stagger initial start to avoid all refreshing at once
      setTimeout(() => {
        if (!this.isDisposed) {
          void this.startTimerForWorkspace(wsId);
        }
      }, index * staggerMs);
    });
  }

  /**
   * Start or restart timer for a specific workspace
   */
  private async startTimerForWorkspace(workspaceId: WorkspaceId): Promise<void> {
    // Clear existing timer
    this.stopTimerForWorkspace(workspaceId);

    const folder = findWorkspaceFolderById(workspaceId);
    if (!folder) {return;}

    const validation = await this.deps.validator.getCached(workspaceId, false);
    if (!validation.hasConfig || !validation.isValid) {
      logInfoMessage(`[RemoteIndexScheduler] Skipping ${folder.name}: no valid config`);
      return;
    }

    const intervalMinutes = vscode.workspace
      .getConfiguration('livesync', folder.uri)
      .get<number>('remoteIndex.autoRefreshInterval', 0);

    // 0 = disabled
    if (intervalMinutes <= 0) {
      logInfoMessage(`[RemoteIndexScheduler] Auto-refresh disabled for ${folder.name}`);
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;

    logInfoMessage(`[RemoteIndexScheduler] Starting timer for ${folder.name}: ${intervalMinutes}min`);

    const timer = setInterval(() => {
      void this.refreshWorkspace(workspaceId, false);
    }, intervalMs);

    this.timers.set(workspaceId, timer);
  }

  /**
   * Stop timer for a workspace
   */
  private stopTimerForWorkspace(workspaceId: WorkspaceId): void {
    const timer = this.timers.get(workspaceId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(workspaceId);
    }
  }

  /**
   * Restart all timers (after config change)
   */
  private restartAllTimers(): void {
    // Clear all existing
    for (const wsId of this.timers.keys()) {
      this.stopTimerForWorkspace(wsId);
    }
    // Re-initialize with stagger
    this.initializeTimers();
  }

  /**
   * Refresh remote index for a workspace
   * 
   * @param workspaceId - Workspace to refresh
   * @param showProgress - Show progress dialog (true for manual, false for auto)
   */
  async refreshWorkspace(workspaceId: WorkspaceId, showProgress: boolean): Promise<void> {
    const folder = findWorkspaceFolderById(workspaceId);
    if (!folder) {return;}

    // Check if workspace has valid config
    const validation = await this.deps.validator.getCached(workspaceId);
    if (!validation.isValid) {
      logInfoMessage(`[RemoteIndexScheduler] Skipping ${folder.name}: invalid config`);
      return;
    }

    // Queue the operation
    await workspaceOperationQueue.enqueue(
      workspaceId,
      'refreshRemoteIndex',
      async () => {
        if (showProgress) {
          await this.refreshWithProgress(workspaceId, folder);
        } else {
          await this.refreshSilent(workspaceId, folder);
        }
      }
    );
  }

  /**
   * Refresh with VS Code progress dialog (manual trigger)
   */
  private async refreshWithProgress(
    workspaceId: WorkspaceId,
    folder: vscode.WorkspaceFolder
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `LiveSync: Refreshing remote index for ${folder.name}`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting...' });

          const remoteIndex = await this.deps.remote.list(workspaceId);

          if (token.isCancellationRequested) {
            void vscode.window.showInformationMessage(
              `LiveSync: Remote refresh cancelled for ${folder.name}`
            );
            return;
          }

          // Update state
          this.deps.state.setRemoteIndex(workspaceId, remoteIndex);
          this.deps.provider.refresh();

          void vscode.window.showInformationMessage(
            `LiveSync: Remote index refreshed for ${folder.name}`
          );
        } catch (err: any) {
          await this.deps.validator.invalidate(workspaceId, err);
          throw err;
        }
      }
    );
  }

  /**
   * Refresh silently with status bar notification (auto trigger)
   */
  private async refreshSilent(
    workspaceId: WorkspaceId,
    folder: vscode.WorkspaceFolder
  ): Promise<void> {
    try {
      this.deps.notifications.notify(
        `Refreshing ${folder.name} remote...`,
        'sync~spin',
        3000
      );

      const remoteIndex = await this.deps.remote.list(workspaceId);

      // Update state
      this.deps.state.setRemoteIndex(workspaceId, remoteIndex);
      this.deps.provider.refresh();

      this.deps.notifications.notifySuccess(`${folder.name} remote refreshed`);
      logInfoMessage(`[RemoteIndexScheduler] Auto-refreshed ${folder.name} remote indexes`);
    } catch (err: any) {
      logExpectedError(`RemoteIndexScheduler:${folder.name}`, err);
      await this.deps.validator.invalidate(workspaceId, err);
      this.deps.notifications.notifyError(`Failed to refresh ${folder.name}`);
    }
  }

  /**
   * Refresh all configured workspaces (staggered)
   */
  async refreshAll(showProgress: boolean): Promise<void> {
    const workspaceIds = getWorkspaceIds();
    const staggerMs = 2000;

    for (let i = 0; i < workspaceIds.length; i++) {
      if (this.isDisposed) {break;}

      const wsId = workspaceIds[i];
      
      // Stagger to avoid hammering connections
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, staggerMs));
      }

      await this.refreshWorkspace(wsId, showProgress);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();

    this.configListener?.dispose();
    this.workspaceFolderListener?.dispose();
  }
}