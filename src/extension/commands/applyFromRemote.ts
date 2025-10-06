import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { joinFs } from '../../infrastructure/workspace/PathJoin';
import { sha1OfFile } from '../../infrastructure/files/FileHash';

export function registerApplyFromRemote(services: Services) {
  const { context, state, remote, provider } = services;

  cmd(context, 'livesync.experimental.node.applyFromRemote', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const relPath: string = node.path;

    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry || entry.type !== 'file') { return; }
    if (!(entry.status === 'removed' || entry.status === 'modified' || entry.status === 'conflict')) { return; }

    const absLocal = joinFs(workspaceId, relPath);
    await remote.downloadFile(workspaceId, relPath, absLocal);
    const hash = await sha1OfFile(absLocal);
    state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
    provider.markRecentlyResolvedBatch(workspaceId, [relPath]);
  });

  cmd(context, 'livesync.experimental.folder.applyFromRemoteRecursively', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const folderPath: string = node.path;
    const diff = state.getDiffEntries(workspaceId);
    const prefix = folderPath ? folderPath + '/' : '';

    const targets = Array.from(diff.entries())
      .filter(([p, e]) =>
        (p === folderPath || p.startsWith(prefix)) &&
        e.type === 'file' &&
        (e.status === 'removed' || e.status === 'modified' || e.status === 'conflict')
      )
      .map(([p]) => p);

    if (!targets.length) {
      vscode.window.showInformationMessage('LiveSync: no items to pull in this folder.');
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Download ${targets.length} file(s) from remote under “${folderPath || '.'}”?`,
      { modal: true }, 'Download'
    );
    if (confirmed !== 'Download') { return; }

    await vscode.window.withProgress(
      { title: 'LiveSync: Downloading from remote…', location: vscode.ProgressLocation.Notification, cancellable: true },
      async (p, token) => {
        let done = 0;
        state.runBatch(workspaceId, folderPath, () => { /* defer recompute */ });

        for (const relPath of targets) {
          if (token.isCancellationRequested) { break; }
          const absLocal = joinFs(workspaceId, relPath);
          await remote.downloadFile(workspaceId, relPath, absLocal);
          const hash = await sha1OfFile(absLocal);
          state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
          done += 1;
          p.report({ message: `${done}/${targets.length}` });
        }

        provider.markRecentlyResolvedBatch(workspaceId, targets);
        vscode.window.showInformationMessage(`LiveSync: downloaded ${done} file(s).`);
      }
    );
  });
}
