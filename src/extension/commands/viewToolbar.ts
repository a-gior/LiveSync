import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import type { NodeIndex, WorkspaceId } from '../../domain/types';
import { resolveWorkspaceFolders } from '@helpers/resolve';
import { stringToWsId } from '@helpers/path';
import { refreshRemoteSnapshot } from '@helpers/remote';

export function registerViewToolbar(services: Services): void {
  const { context, state, config, remote, progress, provider, validator } = services;

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

  // ════════════════════════════════════════════════════════════════════════════
  // DIFF VIEW COMMANDS (workspace-specific)
  // ════════════════════════════════════════════════════════════════════════════

  // Refresh remote index for the CURRENT workspace shown in Diff view
  cmd(context, 'livesync.refreshRemoteIndex', async () => {
    const currentWsId = provider.getCurrentWorkspace();
    if (!currentWsId) {
      void vscode.window.showWarningMessage('LiveSync: no workspace selected.');
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.find(
      f => stringToWsId(f.uri.fsPath) === currentWsId
    );

    if (!folder) {
      void vscode.window.showWarningMessage('LiveSync: workspace folder not found.');
      return;
    }

    await progress.withTask(`Refreshing remote index for ${folder.name}`, async () => {
      await refreshRemoteSnapshot(services, currentWsId);
    });

    void vscode.window.showInformationMessage(`LiveSync: remote index refreshed for ${folder.name}.`);
  });

  // Refresh both local & remote for the CURRENT workspace shown in Diff view
  cmd(context, 'livesync.refresh', async (arg?: vscode.WorkspaceFolder) => {
    let folder: vscode.WorkspaceFolder | undefined;
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

      folder = vscode.workspace.workspaceFolders?.find(
        f => stringToWsId(f.uri.fsPath) === currentWsId
      );

      if (!folder) {
        void vscode.window.showWarningMessage('LiveSync: workspace folder not found.');
        return;
      }
      
      workspaceId = currentWsId;
    }

    // Check config validity before attempting refresh
    const validationResult = validator.getCached(workspaceId);

    if (!validationResult.hasConfig) {
      const choice = await vscode.window.showWarningMessage(
        `Cannot refresh ${folder.name}: No remote configuration found`,
        'Configure'
      );
      if (choice === 'Configure') {
        await vscode.commands.executeCommand('livesync.configuration', { folder });
      }
      return;
    }
    
    if (!validationResult.isValid) {
      const errorMsg = validationResult.error || 'Invalid configuration';
      const choice = await vscode.window.showErrorMessage(
        `Cannot refresh ${folder.name}: ${errorMsg}`,
        'Fix Configuration'
      );
      if (choice === 'Fix Configuration') {
        await vscode.commands.executeCommand('livesync.configuration', { folder });
      }
      return;
    }

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
  });

  // ════════════════════════════════════════════════════════════════════════════
  // WORKSPACES VIEW COMMANDS (all workspaces)
  // ════════════════════════════════════════════════════════════════════════════

  // Refresh ALL workspaces (for use in Workspaces view)
  cmd(context, 'livesync.refreshAll', async (arg?: unknown) => {
    const folders = resolveWorkspaceFolders(arg);
    if (!folders.length) {
      void vscode.window.showWarningMessage('LiveSync: no workspace folders.');
      return;
    }

    const invalidFolders: string[] = [];
    for (const folder of folders) {
      const wsId = stringToWsId(folder.uri.fsPath);
      const result = validator.getCached(wsId);
      if (!result.hasConfig || !result.isValid) {
        invalidFolders.push(`${folder.name}: ${result.error || 'No config'}`);
      }
    }
    
    if (invalidFolders.length > 0) {
      void vscode.window.showErrorMessage(
        `Cannot refresh all: ${invalidFolders.length} workspace(s) have invalid configs:\n${invalidFolders.join('\n')}`
      );
      return;
    }

    await vscode.window.withProgress(
      {
        title: 'LiveSync: Refreshing all workspaces…',
        location: vscode.ProgressLocation.Notification,
        cancellable: true
      },
      async (p, token) => {
        const settings = vscode.workspace.getConfiguration('livesync');
        const concurrency = settings.get<number>('index.concurrency') ?? 4;

        let step = 0;
        for (const folder of folders) {
          if (token.isCancellationRequested) { break; }
          step += 1;

          const wsId = stringToWsId(folder.uri.fsPath);
          const prefix = `${folder.name} (${step}/${folders.length})`;

          // ── Local index
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

          // ── Remote index
          p.report({ message: `${prefix} — remote` });
          let remoteIndex: NodeIndex | undefined;
          try {
            remoteIndex = await remote.list(wsId);
          } catch (e: any) {
            if (e?.name === 'RemoteNotConfiguredError') {
              void vscode.window.setStatusBarMessage(`LiveSync: ${folder.name} — remote not configured`, 2000);
              remoteIndex = undefined;
            } else {
              throw e;
            }
          }

          // ── Commit atomically
          state.runBatch(wsId, undefined as any, () => {
            state.setLocalIndex(wsId, localIndex);
            if (remoteIndex) {
              state.setRemoteIndex(wsId, remoteIndex);
            }
          });

        }

        if (token.isCancellationRequested) {
          void vscode.window.showInformationMessage('LiveSync: refresh cancelled.');
        } else {
          void vscode.window.showInformationMessage('LiveSync: refreshed all workspaces.');
        }
      }
    );
  });
}