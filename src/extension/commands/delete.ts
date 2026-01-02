import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { resolveEntryTarget, resolveFolderTarget } from '@infra/helpers/resolve';
import type { RelPath } from '@domain/types';
import { absFs, relToString, stringToWsId } from '@helpers/path';
import { requireValidRemoteConfig } from '@infra/helpers/config';
import { executeDelete } from '@helpers/action/executor';
import { logExpectedError } from '@helpers/logging';
import { clearIgnoredConflictIfResolved } from '@helpers/conflict/tracker';
import { isTestMode } from '@infra/helpers/test';
import { getFolderLabel } from '@infra/helpers/workspaceFolder';

/**
 * Register delete commands.
 */
export function registerDelete(services: Services): void {
  const { context, state, provider, remote } = services;

  // ═══════════════════════════════════════════════════════════════════════════
  // Single File/Folder Delete
  // ═══════════════════════════════════════════════════════════════════════════
  cmd(context, 'livesync.delete', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) return;
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);
    if (!entry) return;

    // Confirm deletion
    if (!isTestMode()) {
      const label = entry.type === 'file' ? 'file' : 'folder';
      const confirmed = await vscode.window.showWarningMessage(
        `Delete ${label} "${relPath}"?`,
        'Delete'
      );
      if (confirmed !== 'Delete') return;
    }

    // Determine what exists
    const localMeta = state.getLocalMeta(workspaceId, relPath);
    const remoteMeta = state.getRemoteMeta(workspaceId, relPath);
    const existsLocal = !!localMeta;
    const existsRemote = !!remoteMeta;

    if (!existsLocal && !existsRemote) {
      void vscode.window.showErrorMessage('LiveSync: file does not exist locally or remotely');
      return;
    }

    // Execute deletions
    try {
      if (existsLocal) {
        const absPath = absFs(workspaceId, relPath);
        const uri = vscode.Uri.file(absPath);
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
      }

      if (existsRemote) {
        await executeDelete(remote, state, workspaceId, relPath);
      }

      // Cleanup
      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [relPath]);
      clearIgnoredConflictIfResolved(state, workspaceId, relPath);

      void vscode.window.showInformationMessage(`LiveSync: deleted ${entry.type}`);
    } catch (err) {
      logExpectedError(`delete:${relPath}`, err);
      void vscode.window.showErrorMessage(`LiveSync: failed to delete ${entry.type}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Delete (Batch)
  // ═══════════════════════════════════════════════════════════════════════════
  cmd(context, 'livesync.deleteFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) return;
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect all files/folders under this path
    const prefix = relToString(folderPath);
    const entries: RelPath[] = [];
    
    for (const [p, ] of diff.entries()) {
      const inFolder = !prefix || (p as string).startsWith(prefix + '/') || p === prefix;
      if (inFolder) {
        entries.push(p);
      }
    }

    if (entries.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no items to delete');
      return;
    }

    // Confirm deletion
    if (!isTestMode()) {
      const label = getFolderLabel(workspaceId, folderPath);
      const confirmed = await vscode.window.showWarningMessage(
        `Delete folder "${label}" with ${entries.length} item(s)?`,
        'Delete'
      );
      if (confirmed !== 'Delete') return;
    }

    try {
      // Delete local folder if it exists
      const localMeta = state.getLocalMeta(workspaceId, folderPath);
      if (localMeta) {
        const absPath = absFs(workspaceId, folderPath);
        const uri = vscode.Uri.file(absPath);
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
      }

      // Delete remote folder if it exists
      const remoteMeta = state.getRemoteMeta(workspaceId, folderPath);
      if (remoteMeta) {
        await executeDelete(remote, state, workspaceId, folderPath);
      }

      // Cleanup
      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), entries);
      for (const relPath of entries) {
        clearIgnoredConflictIfResolved(state, workspaceId, relPath);
      }

      void vscode.window.showInformationMessage('LiveSync: deleted folder');
    } catch (err) {
      logExpectedError(`deleteFolder:${folderPath}`, err);
      void vscode.window.showErrorMessage('LiveSync: failed to delete folder');
    }
  });
}