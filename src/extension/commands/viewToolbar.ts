import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import type { NodeIndex } from '../../domain/types';
import { resolveWorkspaceFolders } from '../../infrastructure/helpers/resolve';
import { stringToWsId } from '../../infrastructure/helpers/path';
import { refreshRemoteSnapshot } from '../../infrastructure/helpers/remote';

export function registerViewToolbar(services: Services): void {
  const { context, state, config, remote, progress } = services;

  // Toggle "show unchanged" (tree will auto-refresh on configuration change)
  cmd(context, 'livesync.view.toggleShowUnchanged', async () => {
    const cfg = vscode.workspace.getConfiguration('livesync');
    const current = cfg.get<boolean>('view.showUnchanged') ?? false;
    await cfg.update('view.showUnchanged', !current, vscode.ConfigurationTarget.Workspace);
  });

  // Refresh remote index (all workspaces or the targeted one)
  cmd(context, 'livesync.experimental.refreshRemoteIndex', async (arg?: unknown) => {
    const folders = resolveWorkspaceFolders(arg);
    if (!folders.length) {
      void vscode.window.showWarningMessage('LiveSync: no workspace folders.');
      return;
    }

    await progress.withTask('Refreshing remote index', async (report) => {
      let i = 0;
      for (const folder of folders) {
        i += 1;
        report(`${folder.name} (${i}/${folders.length})`);
        const wsId = stringToWsId(folder.uri.fsPath);

        await refreshRemoteSnapshot(services, wsId);
      }
    });

    void vscode.window.showInformationMessage('LiveSync: remote index refreshed.');
  });

  // Refresh both local & remote (all workspaces or the targeted one)
  cmd(context, 'livesync.experimental.refreshAll', async (arg?: unknown) => {
    const folders = resolveWorkspaceFolders(arg);
    if (!folders.length) {
      void vscode.window.showWarningMessage('LiveSync: no workspace folders.');
      return;
    }

    await vscode.window.withProgress(
      {
        title: 'LiveSync: Refreshing local & remote…',
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
              // Skip remote for this workspace; keep whatever we had (or cache).
              void vscode.window.setStatusBarMessage(`LiveSync: ${folder.name} — remote not configured`, 2000);
              remoteIndex = undefined;
            } else {
              throw e;
            }
          }

          // ── Commit atomically so we don’t show half-diffs
          state.runBatch(wsId, undefined as any, () => {
            state.setLocalIndex(wsId, localIndex);
            if (remoteIndex) {
              state.setRemoteIndex(wsId, remoteIndex);
            }
          });

          // ── Persist caches (best effort)
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
          void vscode.window.showInformationMessage('LiveSync: refreshed local & remote.');
        }
      }
    );
  });

}
