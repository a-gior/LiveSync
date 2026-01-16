import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import type { NodeIndex, WorkspaceId } from '../../domain/types';
import { stringToWsId } from '@helpers/path';
import { findWorkspaceFolderById } from '../../infrastructure/helpers/workspaceFolder';
import { logErrorMessage } from '../../infrastructure/helpers/logging';
import { workspaceOperationQueue } from '../../infrastructure/helpers/concurrency/WorkspaceOperationQueue';

export function registerViewToolbar(services: Services): void {
  const { context, state, config, remote, provider, validator } = services;

  // Toggle "show unchanged" - use workspace state
  cmd(context, 'livesync.view.toggleShowUnchanged', async () => {
    const current = context.workspaceState.get<boolean>('livesync.view.showUnchanged', false);
    const newValue = !current;
    
    await context.workspaceState.update('livesync.view.showUnchanged', newValue);
    provider.setShowUnchanged(newValue);
  });

  // Switch to tree view - use workspace state
  cmd(context, 'livesync.view.switchToTree', async () => {
    await context.workspaceState.update('livesync.view.showAsTree', true);
    await vscode.commands.executeCommand('setContext', 'livesyncViewMode', 'tree');
    provider.setShowAsTree(true);
  });

  // Switch to list view - use workspace state
  cmd(context, 'livesync.view.switchToList', async () => {
    await context.workspaceState.update('livesync.view.showAsTree', false);
    await vscode.commands.executeCommand('setContext', 'livesyncViewMode', 'list');
    provider.setShowAsTree(false);
  });

  // Refresh remote index only (manual trigger with progress)
  cmd(context, 'livesync.refreshRemoteIndex', async (arg?: vscode.WorkspaceFolder) => {
    let folder: vscode.WorkspaceFolder;
    let workspaceId: WorkspaceId;

    if (arg && 'uri' in arg) {
      folder = arg;
      workspaceId = stringToWsId(folder.uri.fsPath);
    } else {
      // Use current workspace from diff view
      const currentWsId = provider.getCurrentWorkspace();
      if (!currentWsId) {
        void vscode.window.showWarningMessage('LiveSync: no workspace selected.');
        return;
      }

      const tmpFolder = findWorkspaceFolderById(currentWsId);
      if (!tmpFolder) {
        void vscode.window.showWarningMessage('LiveSync: workspace folder not found.');
        return;
      }

      folder = tmpFolder;
      workspaceId = currentWsId;
    }

    // Validate config
    const validation = await validator.getCached(workspaceId);
    if (!validation.isValid) {
      void vscode.window.showErrorMessage(
        `LiveSync: ${folder.name} has invalid configuration.`
      );
      return;
    }

    // Queue the operation to serialize with other workspace operations
    try {
      await workspaceOperationQueue.enqueue(
        workspaceId,
        'refreshRemoteIndex',
        async () => {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `LiveSync: Refreshing remote index for ${folder.name}`,
              cancellable: true,
            },
            async (p, token) => {
              try {
                p.report({ message: 'Connecting to remote...' });

                const remoteIndex = await remote.list(workspaceId);

                if (token.isCancellationRequested) {
                  void vscode.window.showInformationMessage(
                    `LiveSync: Remote refresh cancelled for ${folder.name}.`
                  );
                  return;
                }

                // Update only remote index
                state.setRemoteIndex(workspaceId, remoteIndex);

                void vscode.window.showInformationMessage(
                  `LiveSync: Remote index refreshed for ${folder.name}.`
                );
              } catch (err: any) {
                await validator.invalidate(workspaceId, err);
                throw err;
              }
            }
          );
        }
      );
    } catch (err: unknown) {
      // Error already logged by queue
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // DIFF VIEW COMMANDS (workspace-specific)
  // ════════════════════════════════════════════════════════════════════════════

  // Refresh both local & remote for the CURRENT workspace shown in Diff view
  cmd(context, 'livesync.refresh', async (arg?: vscode.WorkspaceFolder) => {
    let folder: vscode.WorkspaceFolder;
    let workspaceId: WorkspaceId;

    if (arg && 'uri' in arg) {
      // Called with specific folder (e.g., from config change)
      folder = arg;
      workspaceId = stringToWsId(folder.uri.fsPath);
    } else {
      // Called without args (e.g., from toolbar button) - use current selection
      const currentWsId = provider.getCurrentWorkspace();
      if (!currentWsId) {
        void vscode.window.showWarningMessage('LiveSync: no workspace selected.');
        return;
      }

      const tmpFolder = findWorkspaceFolderById(currentWsId);
      if (!tmpFolder) {
        void vscode.window.showWarningMessage('LiveSync: workspace folder not found.');
        return;
      }
      folder = tmpFolder;
      
      workspaceId = currentWsId;
    }

    // Check config validity before attempting refresh
    const validationResult = await validator.getCached(workspaceId);
    if (!validationResult.isValid) {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          title: `LiveSync: Refreshing ${folder.name}…`,
          location: vscode.ProgressLocation.Notification,
          cancellable: true
        },
        async (p, token) => {
          if (token.isCancellationRequested) { return; }

          const settings = vscode.workspace.getConfiguration('livesync');
          const concurrency = settings.get<number>('index.concurrency') ?? 4;

          // ── Local index
          const eff = await config.get(folder);
          const excludes = eff.ignoreGlobs;
          const { buildLocalIndex } = await import('../../infrastructure/persistence/LocalIndexBuilder');

          let last = 0;
          p.report({ message: 'Building local index…' });
          const localIndex = await buildLocalIndex(folder, {
            excludeGlobs: excludes,
            concurrency,
            token,
            progress: (done, count) => {
              if (done - last > 25 || done === count) {
                last = done;
                p.report({ message: `Local index: ${done}/${count}` });
              }
            }
          }) as NodeIndex;

          // ── Remote index
          p.report({ message: 'Fetching remote index…' });
          let remoteIndex: NodeIndex | undefined;
          try {
            remoteIndex = await remote.list(workspaceId);
          } catch (e: any) {
            if (e?.name === 'RemoteNotConfiguredError') {
              void vscode.window.setStatusBarMessage(`LiveSync: ${folder.name} — remote not configured`, 2000);
              remoteIndex = undefined;
            } else {
              throw e;
            }
          }

          // ── Commit atomically
          state.runBatch(workspaceId, undefined as any, () => {
            state.setLocalIndex(workspaceId, localIndex);
            if (remoteIndex) {
              state.setRemoteIndex(workspaceId, remoteIndex);
            }
          });

          if (token.isCancellationRequested) {
            void vscode.window.showInformationMessage(`LiveSync: refresh cancelled for ${folder.name}.`);
          } else {
            void vscode.window.showInformationMessage(`LiveSync: refreshed ${folder.name}.`);
          }
        }
      );
    } catch (err: any) {
      // Invalidate cache on connection errors
      await validator.invalidate(workspaceId, err);
      throw err;
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // WORKSPACES VIEW COMMANDS (all workspaces)
  // ════════════════════════════════════════════════════════════════════════════

  // Refresh ALL workspaces (for use in Workspaces view)
  cmd(context, 'livesync.refreshAll', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      void vscode.window.showWarningMessage('LiveSync: no workspace folders.');
      return;
    }

    // Quick validation check (but don't rely on it - can change during execution)
    const validationResults = await Promise.all(
      folders.map(async folder => {
        const wsId = stringToWsId(folder.uri.fsPath);
        return {
          folder,
          wsId,
          result: await validator.getCached(wsId, false)
        };
      })
    );

    const validWorkspaces = validationResults.filter(v => v.result.isValid);
    const invalidWorkspaces = validationResults.filter(v => !v.result.isValid);

    if (validWorkspaces.length === 0) {
      void vscode.window.showErrorMessage(
        `Cannot refresh: All ${invalidWorkspaces.length} workspace(s) have invalid configs.`
      );
      return;
    }

    if (invalidWorkspaces.length > 0) {
      void vscode.window.showWarningMessage(
        `Skipping ${invalidWorkspaces.length} invalid workspace(s). Refreshing ${validWorkspaces.length} valid workspace(s).`
      );
    }

    await vscode.window.withProgress(
      {
        title: `LiveSync: Refreshing ${validWorkspaces.length} workspace(s)…`,
        location: vscode.ProgressLocation.Notification,
        cancellable: true
      },
      async (p, token) => {
        const settings = vscode.workspace.getConfiguration('livesync');
        const concurrency = settings.get<number>('index.concurrency') ?? 4;

        let completed = 0;
        let failed = 0;

        for (const { folder, wsId } of validWorkspaces) {
          if (token.isCancellationRequested) { break; }

          const step = completed + failed + 1;
          const prefix = `${folder.name} (${step}/${validWorkspaces.length})`;

          // Per-workspace try-catch - this is where invalidation happens
          try {
            // Build local index
            const eff = await config.get(folder);
            const excludes = eff.ignoreGlobs;
            const { buildLocalIndex } = await import('../../infrastructure/persistence/LocalIndexBuilder');

            let last = 0;
            p.report({ message: `${prefix} — local` });
            const localIndex = await buildLocalIndex(folder, {
              excludeGlobs: excludes,
              concurrency,
              token,
              progress: (done, count) => {
                if (done - last > 25 || done === count) {
                  last = done;
                  p.report({ message: `${prefix} — local ${done}/${count}` });
                }
              }
            }) as NodeIndex;

            // Build remote index
            p.report({ message: `${prefix} — remote` });
            let remoteIndex: NodeIndex | undefined;
            try {
              remoteIndex = await remote.list(wsId);
            } catch (e: any) {
              if (e?.name === 'RemoteNotConfiguredError') {
                void vscode.window.setStatusBarMessage(`LiveSync: ${folder.name} — remote not configured`, 2000);
                remoteIndex = undefined;
              } else {
                throw e; // Re-throw to outer catch for this workspace
              }
            }

            // Commit atomically
            state.runBatch(wsId, undefined as any, () => {
              state.setLocalIndex(wsId, localIndex);
              if (remoteIndex) {
                state.setRemoteIndex(wsId, remoteIndex);
              }
            });

            completed++;
          } catch (err: any) {
            // THIS workspace failed - invalidate ITS cache
            failed++;
            await validator.invalidate(wsId, err);
            logErrorMessage(`[RefreshAll] Failed to refresh ${folder.name}`);
          }
        }

        // Show results
        if (token.isCancellationRequested) {
          void vscode.window.showInformationMessage(
            `LiveSync: Refresh cancelled. Completed ${completed}/${validWorkspaces.length} workspace(s).`
          );
        } else if (failed === 0) {
          void vscode.window.showInformationMessage(
            `LiveSync: Successfully refreshed all ${completed} workspace(s).`
          );
        } else if (completed > 0) {
          void vscode.window.showWarningMessage(
            `LiveSync: Refreshed ${completed}/${validWorkspaces.length} workspace(s). ${failed} failed.`
          );
        } else {
          void vscode.window.showErrorMessage(
            `LiveSync: All ${failed} workspace(s) failed to refresh.`
          );
        }
      }
    );
  });

}