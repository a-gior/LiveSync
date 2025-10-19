import * as vscode from 'vscode';
import * as path from 'path';
import * as fsp from 'fs/promises';

import type { Services } from '../services';
import { cmd } from '../cmd';

import { resolveEntryTarget, resolveFolderTarget } from '../../infrastructure/helpers/resolve';
import type { RelPath } from '../../domain/types';

import { absFs, relToString, isUnder, stringToWsId, stringToRel } from '@infra/helpers/path';
import { withProgress, reportCounter } from '@infra/helpers/async';
import { sha1OfFile } from '@infra/helpers/hash/FileHash';
import { isDownloadable } from '../../infrastructure/helpers/diff';

export function registerApplyFromRemote(services: Services): void {
  const { context, state, remote, provider } = services;

  // ─────────────────────────────────────────────────────────────────────────────
  // Single file: download remote → local and update local index
  // Works from TreeView and Explorer/Editor (URI or active editor).
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.experimental.node.applyFromRemote', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) { return; }

    const { workspaceId, relPath } = target;

    const entry = state.getDiffEntry(workspaceId, relPath);
    if (entry && entry.type !== 'file') { return; }
    if (entry && !isDownloadable(entry.status)) { return; }

    const absLocal = absFs(workspaceId, relPath);
    try {
      await fsp.mkdir(path.dirname(absLocal), { recursive: true });
      await remote.downloadFile(workspaceId, relPath, absLocal);
    } catch (e: any) {
      void vscode.window.showWarningMessage(
        `LiveSync: cannot download “${relToString(relPath)}” (${e?.message ?? e}).`
      );
      return;
    }

    const hash = await sha1OfFile(absLocal);
    state.applyLocal({
      workspaceId,
      type: 'modify',
      path: relPath,
      meta: { type: 'file', hash }
    });

    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [stringToRel(relPath)]);
    void vscode.window.setStatusBarMessage('LiveSync: Downloaded from remote', 1200);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder (recursive): download changed files under folder and batch-apply
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.experimental.folder.applyFromRemoteRecursively', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) { return; }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect target files under folder that are downloadable
    const targets: RelPath[] = [];
    for (const [p, e] of diff.entries()) {
      if (!isUnder(folderPath, p)) { continue; }
      if (e.type !== 'file') { continue; }
      if (isDownloadable(e.status)) {
        targets.push(p);
      }
    }

    if (targets.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no items to pull in this folder.');
      return;
    }

    const label = relToString(folderPath) || '.';
    const confirmed = await vscode.window.showWarningMessage(
      `Download ${targets.length} file(s) from remote under “${label}”?`,
      { modal: true },
      'Download'
    );
    if (confirmed !== 'Download') { return; }

    await withProgress('LiveSync: Downloading from remote…', async (p, token) => {
      const applied: Array<{ path: RelPath; hash: string }> = [];
      let done = 0;

      for (const rel of targets) {
        if (token.isCancellationRequested) { break; }
        const absLocal = absFs(workspaceId, rel);
        try {
          await fsp.mkdir(path.dirname(absLocal), { recursive: true });
          await remote.downloadFile(workspaceId, rel, absLocal);
          const hash = await sha1OfFile(absLocal);
          applied.push({ path: rel, hash });
        } catch (e: any) {
          void vscode.window.showWarningMessage(
            `LiveSync: skip “${relToString(rel)}” (${e?.message ?? e}).`
          );
        }
        done += 1;
        reportCounter(p, done, targets.length);
      }

      // Batch apply local snapshot updates once
      state.runBatch(workspaceId, stringToRel(folderPath), () => {
        for (const a of applied) {
          state.applyLocal({
            workspaceId,
            type: 'modify',
            path: a.path,
            meta: { type: 'file', hash: a.hash }
          });
        }
      });

      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), targets);
      void vscode.window.showInformationMessage(`LiveSync: downloaded ${applied.length} file(s).`);
    });
  });
}
