import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';

import { resolveEntryTarget, resolveFolderTarget } from '../../infrastructure/helpers/resolve';
import type { RelPath } from '../../domain/types';

import { absFs, relToString, stringToRel, stringToWsId } from '@helpers/path';
import { partitionChangesUnder, topMost } from '@helpers/diff';
import { withProgress, reportCounter } from '@helpers/async';
import { refreshRemoteSnapshot } from '@helpers/remote';
import { logExpectedError } from '../../infrastructure/helpers/logging';

export function registerApplyToRemote(services: Services): void {
  const { context, state, remote, provider } = services;

  // ─────────────────────────────────────────────────────────────────────────────
  // Single entry (file): push local change to remote.
  // - added/modified/conflict → upload file
  // - removed → delete remote path
  // Works from TreeView and Explorer/Editor (URI or active editor).
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.experimental.node.applyToRemote', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) { return; }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // If invoked from editor/explorer with no diff entry yet, try a pragmatic upload.
    if (!entry) {
      const abs = absFs(workspaceId, relPath);
      try {
        await remote.uploadFile(workspaceId, relPath, abs);
      } catch (e: any) {
        void vscode.window.showWarningMessage(
          `LiveSync: failed to upload “${relToString(relPath)}” (${e?.message ?? e}).`
        );
        return;
      }

      try {
        await refreshRemoteSnapshot(services, workspaceId);
      } catch {
        // ignore refresh errors here; user action succeeded
      }
      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [stringToRel(relPath)]);
      return;
    }

    if (entry.type !== 'file') {
      return; // only files here; use the recursive variant for folders
    }

    try {
      if (entry.status === 'added' || entry.status === 'modified' || entry.status === 'conflict') {
        const abs = absFs(workspaceId, relPath);
        await remote.uploadFile(workspaceId, relPath, abs);
      } else if (entry.status === 'removed') {
        await remote.deletePath(workspaceId, relPath);
      } else {
        return; // unchanged → nothing to do
      }
    } catch (e: any) {
      void vscode.window.showWarningMessage(
        `LiveSync: remote update failed for “${relToString(relPath)}” (${e?.message ?? e}).`
      );
      return;
    }

    try {
      await refreshRemoteSnapshot(services, workspaceId);
    } catch {
      // ignore refresh errors; action itself completed
    }
    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [stringToRel(relPath)]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder (recursive): apply all changes under folder to remote.
  // - Upload added/modified/conflict files
  // - Delete removed files
  // - Delete removed folders (top-most) to clean up empty dirs (recursive)
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.experimental.folder.applyToRemoteRecursively', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) { return; }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    const { toUploadFiles, toDeleteFiles, removedDirs } = partitionChangesUnder(diff, folderPath);
    if (toUploadFiles.length === 0 && toDeleteFiles.length === 0 && removedDirs.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: nothing to apply in this folder.');
      return;
    }

    const removedDirsTop = topMost(removedDirs);

    await withProgress('LiveSync: Applying changes to remote…', async (p, token) => {
      let done = 0;
      const total = toUploadFiles.length + (removedDirsTop.length > 0 ? removedDirsTop.length : toDeleteFiles.length);

      // 1) Upload files
      for (const rel of toUploadFiles) {
        if (token.isCancellationRequested) { break; }
        try {
          await services.remote.uploadFile(workspaceId, rel, absFs(workspaceId, rel));
        } catch (e: any) {
          void vscode.window.showWarningMessage(
            `LiveSync: upload failed “${relToString(rel)}” (${e?.message ?? e}).`
          );
        }
        done += 1;
        reportCounter(p, done, total);
      }

      // 2) Delete removed dirs (top-most) OR deleted files if no dirs
      if (removedDirsTop.length > 0) {
        // Delete deeper ones later (descending length) — cosmetic; remote.deletePath is recursive.
        const dirsDesc = [...removedDirsTop].sort((a, b) => relToString(b).length - relToString(a).length);
        for (const dir of dirsDesc) {
          if (token.isCancellationRequested) { break; }
          try {
            await services.remote.deletePath(workspaceId, dir);
          } catch {
            // Might already be gone due to parent delete; ignore
          }
          done += 1;
          reportCounter(p, done, total);
        }
      } else {
        for (const rel of toDeleteFiles) {
          if (token.isCancellationRequested) { break; }
          try {
            await services.remote.deletePath(workspaceId, rel);
          } catch {
            // Ignore ENOENT; keep going
          }
          done += 1;
          reportCounter(p, done, total);
        }
      }

      // 3) Refresh remote once → diff recompute → UI refresh
      try {
        await refreshRemoteSnapshot(services, workspaceId);
      } catch(err) {
        // ignore; operations already attempted
        logExpectedError('applyToRemote:refreshSnapshot', err);
      }

      // 4) Recently-resolved fade
      const resolved: RelPath[] = [
        ...toUploadFiles,
        ...(removedDirsTop.length > 0 ? removedDirsTop : toDeleteFiles),
      ];
      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), resolved);
    });
  });
}
