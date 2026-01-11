/**
 * Delete Commands
 * 
 * Single file and folder delete commands.
 * Single file command now uses unified handleAction().
 */

import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { resolveEntryTarget, resolveFolderTarget } from '@infra/helpers/resolve';
import type { RelPath } from '@domain/types';
import { requireValidRemoteConfig } from '@infra/helpers/config';
import pLimit from 'p-limit';
import { handleAction } from '@helpers/action/handler';
import { logExpectedError } from '@helpers/logging';

const BATCH_CONCURRENCY = 25;
const PROGRESS_THROTTLE_MS = 250;

/**
 * Register delete commands
 */
export function registerDelete(services: Services): void {
  const { context, state, config, provider, remote, validator, notifications } = services;

  // ═══════════════════════════════════════════════════════════════════════════
  // Single File Delete
  // ═══════════════════════════════════════════════════════════════════════════
  
  cmd(context, 'livesync.delete', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) {return;}
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Only allow deleting files (not folders)
    if (entry && entry.type !== 'file') {return;}

    // Capture metas
    const oldLocalMeta = state.getLocalMeta(workspaceId, relPath);
    const oldRemoteMeta = state.getRemoteMeta(workspaceId, relPath);
    const actualLocalMeta = state.getLocalMeta(workspaceId, relPath);
    
    // Call unified handler
    await handleAction({
      workspaceId,
      relPath,
      policyKey: 'actionOnDelete',
      operation: 'delete',
      actualMetas: {
        local: actualLocalMeta,
        remote: undefined  // Fetched inside handleAction
      },
      oldMetas: {
        local: oldLocalMeta,
        remote: oldRemoteMeta
      },
      isCommand: true,  // Commands override ignored files
      
      // Services
      state,
      config,
      validator,
      remote,
      notifications,
      provider,
      shouldIgnore: async (wsId, rPath) => {
        const cfg = await config.getById(wsId);
        return cfg.ignoreFilter.shouldIgnore(rPath as string);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Delete (batch)
  // ═══════════════════════════════════════════════════════════════════════════
  
  cmd(context, 'livesync.deleteFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) {return;}

    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    
    // Get all entries in this folder
    const diff = state.getDiffEntries(workspaceId);
    const entries: RelPath[] = [];
    
    for (const [p, e] of diff.entries()) {
      const inFolder = folderPath === '' 
        ? true 
        : (p as string).startsWith((folderPath as string) + '/') || p === folderPath;
      
      if (inFolder && e.type === 'file') {
        entries.push(p);
      }
    }

    if (entries.length === 0) {
      // Refresh before showing message
      await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
      void vscode.window.showInformationMessage('LiveSync: no items to delete');
      return;
    }

    // Confirm deletion
    const folderName = folderPath === '' ? 'workspace' : folderPath;
    const confirmation = await vscode.window.showWarningMessage(
      `Delete ${entries.length} remote file(s) in ${folderName}?`,
      { modal: true },
      'Delete'
    );

    if (confirmation !== 'Delete') {
      return;
    }

    // Batch delete with progress
    const limit = pLimit(BATCH_CONCURRENCY);
    let completed = 0;
    let lastProgressUpdate = Date.now();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LiveSync: Deleting files',
        cancellable: false
      },
      async (progress) => {
        const tasks = entries.map((relPath) =>
          limit(async () => {
            try {
              await remote.deletePath(workspaceId, relPath);
              completed++;

              const now = Date.now();
              if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
                progress.report({
                  message: `${completed}/${entries.length} files`,
                  increment: (100 / entries.length)
                });
                lastProgressUpdate = now;
              }
            } catch (err) {
              logExpectedError(`deleteFolder:${relPath}`, err);
            }
          })
        );

        await Promise.all(tasks);
        progress.report({ message: `${completed}/${entries.length} files`, increment: 100 });
      }
    );

    // Refresh after batch delete
    await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
    void vscode.window.showInformationMessage(`LiveSync: Deleted ${completed} file(s)`);
  });
}