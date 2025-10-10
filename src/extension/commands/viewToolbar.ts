import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';

export function registerViewToolbar(services: Services) {
  const { context, state, config, remote, progress } = services;

  cmd(context, 'livesync.view.toggleShowUnchanged', async () => {
    const cfg = vscode.workspace.getConfiguration('livesync');
    const current = cfg.get<boolean>('view.showUnchanged') ?? false;
    await cfg.update('view.showUnchanged', !current, vscode.ConfigurationTarget.Workspace);
    // ExperimentalTreeProvider listens to configuration changes and will refresh.
  });

  cmd(context, 'livesync.experimental.refreshRemoteIndex', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      vscode.window.showWarningMessage('LiveSync: no workspace folders.');
      return;
    }

    await progress.withTask('Refreshing remote index', async (report) => {
      let i = 0;
      for (const folder of folders) {
        i += 1;
        report(`${folder.name} (${i}/${folders.length})`);
        const wsId = folder.uri.fsPath;
        const remoteIndex = await remote.list(wsId);
        state.setRemoteIndex(wsId, remoteIndex);
      }
    });

    vscode.window.showInformationMessage('LiveSync: remote index refreshed.');
  });

  cmd(context, 'livesync.experimental.refreshAll', async () => {
    // Run local + remote; reuse your existing local index command logic via code, not by invoking the command ID,
    // to keep progress in a single task UI. If you prefer, you can call the existing command twice instead.
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      vscode.window.showWarningMessage('LiveSync: no workspace folders.');
      return;
    }

    await vscode.window.withProgress(
      { title: 'LiveSync: Refreshing local & remote…', location: vscode.ProgressLocation.Notification, cancellable: true },
      async (p, token) => {
        // Local
        const settings = vscode.workspace.getConfiguration('livesync');
        const concurrency = settings.get<number>('index.concurrency') ?? 4;
        let step = 0;
        for (const folder of folders) {
          if (token.isCancellationRequested) { break; }
          step += 1;
          const prefix = `${folder.name} (${step}/${folders.length})`;

          const eff = await config.get(folder);
          const excludes = eff.ignoreGlobs;

          const { buildLocalIndex } = await import('../../infrastructure/persistence/LocalIndexBuilder');
          let last = 0;
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
          });
          state.setLocalIndex(folder.uri.fsPath, localIndex);
        }

        // Remote
        step = 0;
        for (const folder of folders) {
          if (token.isCancellationRequested) { break; }
          step += 1;
          p.report({ message: `${folder.name} (${step}/${folders.length}) — remote` });
          const wsId = folder.uri.fsPath;
          const remoteIndex = await remote.list(wsId);
          state.setRemoteIndex(wsId, remoteIndex);
        }

        if (token.isCancellationRequested) {
          vscode.window.showInformationMessage('LiveSync: refresh cancelled.');
        } else {
          vscode.window.showInformationMessage('LiveSync: refreshed local & remote.');
        }
      }
    );
  });
}
