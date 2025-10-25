import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import type { NodeIndex } from '../../domain/types';
import { resolveWorkspaceFolders } from '@helpers/resolve';
import { stringToWsId } from '@helpers/path';
import { refreshRemoteSnapshot } from '@helpers/remote';

export function registerViewToolbar(services: Services): void {
  const { context, state, config, remote, progress, provider } = services;

  // Toggle "show unchanged"
  cmd(context, 'livesync.view.toggleShowUnchanged', async () => {
    const cfg = vscode.workspace.getConfiguration('livesync');
    const current = cfg.get<boolean>('view.showUnchanged') ?? false;
    await cfg.update('view.showUnchanged', !current, vscode.ConfigurationTarget.Workspace);
  });

  // Switch to tree view
  cmd(context, 'livesync.view.switchToTree', async () => {
    const cfg = vscode.workspace.getConfiguration('livesync');
    await cfg.update('view.showAsTree', true, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('setContext', 'livesyncViewMode', 'tree');
    provider.setShowAsTree(true);
  });

  // Switch to list view
  cmd(context, 'livesync.view.switchToList', async () => {
    const cfg = vscode.workspace.getConfiguration('livesync');
    await cfg.update('view.showAsTree', false, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('setContext', 'livesyncViewMode', 'list');
    provider.setShowAsTree(false);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // DIFF VIEW COMMANDS (workspace-specific)
  // ════════════════════════════════════════════════════════════════════════════

  // Refresh remote index for the CURRENT workspace shown in Diff view
  cmd(context, 'livesync.experimental.refreshRemoteIndex', async () => {
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
  cmd(context, 'livesync.experimental.refresh', async () => {
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
          remoteIndex = await remote.list(currentWsId);
        } catch (e: any) {
          if (e?.name === 'RemoteNotConfiguredError') {
            void vscode.window.setStatusBarMessage(`LiveSync: ${folder.name} — remote not configured`, 2000);
            remoteIndex = undefined;
          } else {
            throw e;
          }
        }

        // ── Commit atomically
        state.runBatch(currentWsId, undefined as any, () => {
          state.setLocalIndex(currentWsId, localIndex);
          if (remoteIndex) {
            state.setRemoteIndex(currentWsId, remoteIndex);
          }
        });

        // ── Persist caches
        try {
          await services.localCache.save(currentWsId, localIndex);
          if (remoteIndex) {
            await services.remoteCache.save(currentWsId, remoteIndex);
          }
        } catch {
          // ignore cache write errors
        }

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
  cmd(context, 'livesync.experimental.refreshAll', async (arg?: unknown) => {
    const folders = resolveWorkspaceFolders(arg);
    if (!folders.length) {
      void vscode.window.showWarningMessage('LiveSync: no workspace folders.');
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

          // ── Persist caches
          try {
            await services.localCache.save(wsId, localIndex);
            if (remoteIndex) {
              await services.remoteCache.save(wsId, remoteIndex);
            }
          } catch {
            // ignore cache write errors
          }
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