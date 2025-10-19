import * as vscode from 'vscode';
import * as path from 'path';
import * as fsp from 'fs/promises';

import type { Services } from '../services';
import { cmd } from '../cmd';

import { resolveEntryTarget, resolveFolderTarget } from '../../infrastructure/helpers/resolve';
import type { RelPath } from '../../domain/types';

import { absFs, relToString, isUnder, stringToWsId, stringToRel } from '@infra/helpers/path';
import { withProgress, reportCounter } from '@infra/helpers/async';
import { refreshRemoteSnapshot } from '@infra/helpers/remote';
import { sha1OfFile } from '@infra/helpers/hash/FileHash';
import { isResolvable } from '../../infrastructure/helpers/diff';
import { logExpectedError } from '../../infrastructure/helpers/logging';

export function registerConflictResolver(services: Services): void {
  const { context, state, remote, provider } = services;

  // ─────────────────────────────────────────────────────────────────────────────
  // Per-file: Keep Local (upload)
  // Works from TreeView and Explorer/Editor (URI or active editor).
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.resolve.keepLocal', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) { return; }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry || entry.type !== 'file' || !isResolvable(entry.status)) { return; }

    const absLocal = absFs(workspaceId, relPath);
    try {
      await remote.uploadFile(workspaceId, relPath, absLocal);
    } catch (e: any) {
      void vscode.window.showWarningMessage(
        `LiveSync: failed to upload “${relToString(relPath)}” (${e?.message ?? e}).`
      );
      return;
    }

    // Single refresh → recompute diff
    try {
      await refreshRemoteSnapshot(services, workspaceId);
    } catch {
      // ignore refresh errors; the user action succeeded
    }

    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [stringToRel(relPath)]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Per-file: Keep Remote (download)
  // Works from TreeView and Explorer/Editor (URI or active editor).
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.resolve.keepRemote', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) { return; }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry || entry.type !== 'file' || !isResolvable(entry.status)) { return; }

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
    state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [stringToRel(relPath)]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder: Keep Local (upload all resolvable)
  // Uploads modified/conflict files under folder, then single remote refresh.
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.resolveFolder.keepLocal', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) { return; }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect resolvable files under the folder
    const targets: RelPath[] = [];
    for (const [p, e] of diff.entries()) {
      if (!isUnder(folderPath, p)) { continue; }
      if (e.type === 'file' && isResolvable(e.status)) {
        targets.push(p);
      }
    }

    if (targets.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no modified/conflict files in this folder.');
      return;
    }

    await withProgress('LiveSync: Resolving (Keep Local)…', async (progress, token) => {
      let done = 0;

      for (const rel of targets) {
        if (token.isCancellationRequested) { break; }
        try {
          await remote.uploadFile(workspaceId, rel, absFs(workspaceId, rel));
        } catch (e: any) {
          void vscode.window.showWarningMessage(
            `LiveSync: upload failed “${relToString(rel)}” (${e?.message ?? e}).`
          );
        }
        done += 1;
        reportCounter(progress, done, targets.length);
      }

      // Single remote refresh → diff recompute
      try {
        await refreshRemoteSnapshot(services, workspaceId);
      } catch(err) {
        // ignore; uploads already attempted
        logExpectedError('conflictResolver:refreshSnapshot', err);
      }

      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), targets);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder: Keep Remote (download all resolvable)
  // Downloads modified/conflict files and applies local updates in a single batch.
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.resolveFolder.keepRemote', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) { return; }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect resolvable files under the folder
    const targets: RelPath[] = [];
    for (const [p, e] of diff.entries()) {
      if (!isUnder(folderPath, p)) { continue; }
      if (e.type === 'file' && isResolvable(e.status)) {
        targets.push(p);
      }
    }

    if (targets.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no modified/conflict files in this folder.');
      return;
    }

    await withProgress('LiveSync: Resolving (Keep Remote)…', async (progress, token) => {
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
        reportCounter(progress, done, targets.length);
      }

      // Batch apply to avoid multiple recomputes
      state.runBatch(workspaceId, stringToRel(folderPath), () => {
        for (const a of applied) {
          state.applyLocal({
            workspaceId,
            type: 'modify',
            path: a.path,
            meta: { type: 'file', hash: a.hash },
          });
        }
      });

      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), targets);
    });
  });
}
