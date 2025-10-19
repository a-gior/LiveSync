import * as vscode from 'vscode';
import * as path from 'path';
import { tmpdir } from 'os';

import type { Services } from '../services';
import { cmd } from '../cmd';
import { absFs } from '../../infrastructure/helpers/path/PathJoin';
import { tempPathFor, ensureEmptyFile } from '@helpers/tempFiles';
import { resolveDiffTarget } from '../../infrastructure/helpers/resolve';
import { stringToRel, stringToWsId } from '../../infrastructure/helpers/path';

export function registerShowDiff(services: Services): void {
  const { context, state, remote, provider } = services;

  cmd(context, 'livesync.experimental.node.showDiff', async (arg?: unknown) => {
    const target = resolveDiffTarget(arg);
    if (!target) { return; }

    const { workspaceId, relPath } = target;

    const entry = state.getDiffEntry(workspaceId, relPath);
    if (entry && entry.type !== 'file') { return; }

    const absLocal = absFs(workspaceId, relPath);
    const remoteTmp = path.join(tmpdir(), `livesync-diff-${Date.now()}-${path.basename(absLocal)}`);

    let left: vscode.Uri;   // Remote (or empty)
    let right: vscode.Uri;  // Local (or empty)

    if (entry?.status === 'added') {
      await ensureEmptyFile(remoteTmp);
      left = vscode.Uri.file(remoteTmp);
      right = vscode.Uri.file(absLocal);
    } else if (entry?.status === 'removed') {
      try { await remote.downloadFile(workspaceId, relPath, remoteTmp); } catch { await ensureEmptyFile(remoteTmp); }
      left = vscode.Uri.file(remoteTmp);
      const empty = await tempPathFor(context, relPath + '.empty'); await ensureEmptyFile(empty);
      right = vscode.Uri.file(empty);
    } else {
      try { await remote.downloadFile(workspaceId, relPath, remoteTmp); } catch { await ensureEmptyFile(remoteTmp); }
      left = vscode.Uri.file(remoteTmp);
      right = vscode.Uri.file(absLocal);
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `Remote ↔ Local: ${relPath as unknown as string}`,
      { preview: true }
    );

    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [stringToRel(relPath)]);
  });
}
