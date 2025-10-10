import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { joinFs } from '../../infrastructure/workspace/PathJoin';
import { sha1OfFile } from '../../infrastructure/files/FileHash';

function isResolvable(status: string): boolean {
  return status === 'modified' || status === 'conflict';
}

export function registerConflictResolver(services: Services) {
  const { context, state, remote, provider } = services;

  // ---- Per-file: Keep Local (upload) ----
  cmd(context, 'livesync.resolve.keepLocal', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const relPath: string = node.path;

    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry || entry.type !== 'file' || !isResolvable(entry.status)) { return; }

    const absLocal = joinFs(workspaceId, relPath);
    await remote.uploadFile(workspaceId, relPath, absLocal);

    const newRemote = await remote.list(workspaceId);
    state.setRemoteIndex(workspaceId, newRemote);
    provider.markRecentlyResolvedBatch(workspaceId, [relPath]);
  });

  // ---- Per-file: Keep Remote (download) ----
  cmd(context, 'livesync.resolve.keepRemote', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const relPath: string = node.path;

    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry || entry.type !== 'file' || !isResolvable(entry.status)) { return; }

    const absLocal = joinFs(workspaceId, relPath);
    await remote.downloadFile(workspaceId, relPath, absLocal);

    const hash = await sha1OfFile(absLocal);
    state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });

    provider.markRecentlyResolvedBatch(workspaceId, [relPath]);
  });

  // ---- Folder: Keep Local (upload all resolvable) ----
  cmd(context, 'livesync.resolveFolder.keepLocal', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const folderPath: string = node.path;
    const diff = state.getDiffEntries(workspaceId);
    const prefix = folderPath ? folderPath + '/' : '';

    const targets = Array.from(diff.entries())
      .filter(([p, e]) =>
        (p === folderPath || p.startsWith(prefix)) && e.type === 'file' && isResolvable(e.status)
      )
      .map(([p]) => p);

    if (targets.length === 0) {
      vscode.window.showInformationMessage('LiveSync: no modified/conflict files in this folder.');
      return;
    }

    await vscode.window.withProgress(
      { title: 'LiveSync: Resolving (Keep Local)…', location: vscode.ProgressLocation.Notification, cancellable: true },
      async (progress, token) => {
        let done = 0;
        for (const relPath of targets) {
          if (token.isCancellationRequested) { break; }
          await remote.uploadFile(workspaceId, relPath, joinFs(workspaceId, relPath));
          done += 1;
          progress.report({ message: `${done}/${targets.length}` });
        }
        const newRemote = await remote.list(workspaceId);
        state.setRemoteIndex(workspaceId, newRemote);
        provider.markRecentlyResolvedBatch(workspaceId, targets);
      }
    );
  });

  // ---- Folder: Keep Remote (download all resolvable) ----
  cmd(context, 'livesync.resolveFolder.keepRemote', async (node: any) => {
    if (!node || node.kind !== 'entry') { return; }
    const workspaceId: string = node.workspaceId;
    const folderPath: string = node.path;
    const diff = state.getDiffEntries(workspaceId);
    const prefix = folderPath ? folderPath + '/' : '';

    const targets = Array.from(diff.entries())
      .filter(([p, e]) =>
        (p === folderPath || p.startsWith(prefix)) && e.type === 'file' && isResolvable(e.status)
      )
      .map(([p]) => p);

    if (targets.length === 0) {
      vscode.window.showInformationMessage('LiveSync: no modified/conflict files in this folder.');
      return;
    }

    await vscode.window.withProgress(
      { title: 'LiveSync: Resolving (Keep Remote)…', location: vscode.ProgressLocation.Notification, cancellable: true },
      async (progress, token) => {
        let done = 0;
        for (const relPath of targets) {
          if (token.isCancellationRequested) { break; }
          const absLocal = joinFs(workspaceId, relPath);
          await remote.downloadFile(workspaceId, relPath, absLocal);
          const hash = await sha1OfFile(absLocal);
          state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
          done += 1;
          progress.report({ message: `${done}/${targets.length}` });
        }
        provider.markRecentlyResolvedBatch(workspaceId, targets);
      }
    );
  });
}
