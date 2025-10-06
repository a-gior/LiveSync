import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import { buildLocalIndex } from '../../infrastructure/persistence/LocalIndexBuilder';

export function registerIndexLocal(services: Services) {
  const { context, state, config } = services;

  cmd(context, 'livesync.experimental.indexLocal', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      vscode.window.showWarningMessage('No workspace folders open.');
      return;
    }

    await vscode.window.withProgress(
      { title: 'LiveSync: Building local index…', location: vscode.ProgressLocation.Notification, cancellable: true },
      async (progress, token) => {
        const total = folders.length;
        let processed = 0;

        for (const folder of folders) {
          if (token.isCancellationRequested) { break; }
          processed += 1;

          const prefix = `${folder.name} (${processed}/${total})`;
          let last = 0;

          const eff = await config.get(folder);
          const settings = vscode.workspace.getConfiguration('livesync');
          const extraExcludes = settings.get<string[]>('index.excludeGlobs') ?? [];
          const concurrency = settings.get<number>('index.concurrency') ?? 4;
          const excludes = [...eff.ignoreGlobs, ...extraExcludes];

          const localIndex = await buildLocalIndex(folder, {
            excludeGlobs: excludes,
            concurrency,
            token,
            progress: (done, count) => {
              if (done - last > 25 || done === count) {
                last = done;
                progress.report({ message: `${prefix} — ${done}/${count}` });
              }
            }
          });

          state.setLocalIndex(folder.uri.fsPath, localIndex);
        }

        vscode.window.showInformationMessage(token.isCancellationRequested
          ? 'LiveSync: Local index cancelled.' : 'LiveSync: Local index built.');
      }
    );
  });
}
