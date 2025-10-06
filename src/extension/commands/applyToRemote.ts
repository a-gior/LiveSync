import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { joinFs } from '../../infrastructure/workspace/PathJoin';

export function registerApplyToRemote(services: Services) {
  const { context, state, remote, provider } = services;

  cmd(context, 'livesync.experimental.node.applyToRemote', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const relPath: string = node.path;
    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry || entry.type !== 'file') { return; }

    if (entry.status === 'removed') {
      await remote.deletePath(workspaceId, relPath);
    } else if (entry.status === 'added' || entry.status === 'modified' || entry.status === 'conflict') {
      const absLocal = joinFs(workspaceId, relPath);
      await remote.uploadFile(workspaceId, relPath, absLocal);
    } else {
      return;
    }

    const newRemote = await remote.list(workspaceId);
    state.setRemoteIndex(workspaceId, newRemote);
    provider.markRecentlyResolvedBatch(workspaceId, [relPath]);
  });

  cmd(context, 'livesync.experimental.folder.applyToRemoteRecursively', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const folderPath: string = node.path;
    const diff = state.getDiffEntries(workspaceId);
    const prefix = folderPath ? folderPath + '/' : '';

    const toApply = Array.from(diff.entries())
      .filter(([p, e]) =>
        (p === folderPath || p.startsWith(prefix)) &&
        e.type === 'file' &&
        (e.status === 'added' || e.status === 'modified' || e.status === 'removed' || e.status === 'conflict')
      );

    if (!toApply.length) { return; }

    await vscode.window.withProgress(
      { title: 'LiveSync: Applying changes to remote…', location: vscode.ProgressLocation.Notification, cancellable: true },
      async (p, token) => {
        let done = 0;
        for (const [filePath, entry] of toApply) {
          if (token.isCancellationRequested) { break; }
          if (entry.status === 'removed') {
            await remote.deletePath(workspaceId, filePath);
          } else {
            const absLocal = joinFs(workspaceId, filePath);
            await remote.uploadFile(workspaceId, filePath, absLocal);
          }
          done += 1;
          p.report({ message: `${done}/${toApply.length}` });
        }
        const newRemote = await remote.list(workspaceId);
        state.setRemoteIndex(workspaceId, newRemote);
        provider.markRecentlyResolvedBatch(workspaceId, toApply.map(([p]) => p));
      }
    );
  });
}
