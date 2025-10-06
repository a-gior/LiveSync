import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { joinFs } from '../../infrastructure/workspace/PathJoin';
import { tempPathFor, ensureEmptyFile } from '../../infrastructure/tempFiles';

export function registerShowDiff(services: Services) {
  const { context, state, remote, provider } = services;

  cmd(context, 'livesync.experimental.node.showDiff', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const relPath: string = node.path;
    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry || entry.type !== 'file') { return; }

    const localFs = joinFs(workspaceId, relPath);
    const remoteTmp = await tempPathFor(context, relPath);

    let left: vscode.Uri;
    let right: vscode.Uri;

    if (entry.status === 'added') {
      await ensureEmptyFile(remoteTmp);
      left = vscode.Uri.file(remoteTmp);
      right = vscode.Uri.file(localFs);
    } else if (entry.status === 'removed') {
      await remote.downloadFile(workspaceId, relPath, remoteTmp);
      left = vscode.Uri.file(remoteTmp);
      const empty = await tempPathFor(context, relPath + '.empty');
      await ensureEmptyFile(empty);
      right = vscode.Uri.file(empty);
    } else {
      await remote.downloadFile(workspaceId, relPath, remoteTmp);
      left = vscode.Uri.file(remoteTmp);
      right = vscode.Uri.file(localFs);
    }

    await vscode.commands.executeCommand('vscode.diff', left, right, `Remote ↔ Local: ${relPath}`, { preview: true });
    provider.markRecentlyResolvedBatch(workspaceId, [relPath]); // optional: keep visible briefly after open
  });
}
