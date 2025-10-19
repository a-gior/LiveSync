import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import { buildLocalIndex } from '../../infrastructure/persistence/LocalIndexBuilder';
import type { NodeIndex } from '../../domain/types';
import { resolveWorkspaceFolders } from '../../infrastructure/helpers/resolve';
import { stringToWsId } from '../../infrastructure/helpers/path';

export function registerIndexLocal(services: Services): void {
  const { context, state, config } = services;

  cmd(context, 'livesync.experimental.indexLocal', async (arg?: unknown) => {
    const folders = resolveWorkspaceFolders(arg);
    if (!folders.length) {
      void vscode.window.showWarningMessage('No workspace folders open.');
      return;
    }

    await vscode.window.withProgress(
      {
        title: 'LiveSync: Building local index…',
        location: vscode.ProgressLocation.Notification,
        cancellable: true
      },
      async (progress, token) => {
        const total = folders.length;
        let processed = 0;

        for (const folder of folders) {
          if (token.isCancellationRequested) {
            break;
          }
          processed += 1;

          const prefix = `${folder.name} (${processed}/${total})`;
          let last = 0;

          // Effective settings for this workspace
          // (your service supports get(WorkspaceFolder); if you prefer, switch to getById(wsId))
          const eff = await config.get(folder);
          const settings = vscode.workspace.getConfiguration('livesync');
          const concurrency = settings.get<number>('index.concurrency') ?? 4;
          const excludes = eff.ignoreGlobs;

          // Build index for this folder
          const localIndex = (await buildLocalIndex(folder, {
            excludeGlobs: excludes,
            concurrency,
            token,
            progress: (done, count) => {
              if (done - last > 25 || done === count) {
                last = done;
                progress.report({ message: `${prefix} — ${done}/${count}` });
              }
            }
          })) as NodeIndex;

          // Commit under branded WorkspaceId
          const wsId = stringToWsId(folder.uri.fsPath);
          state.setLocalIndex(wsId, localIndex);
          await services.localCache.save(wsId, localIndex);

        }

        void vscode.window.showInformationMessage(
          token.isCancellationRequested
            ? 'LiveSync: Local index cancelled.'
            : 'LiveSync: Local index built.'
        );
      }
    );
  });
}
