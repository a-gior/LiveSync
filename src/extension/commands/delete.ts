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
import { absFs } from '../../infrastructure/helpers/path';
import { isTestMode } from '../../infrastructure/helpers/test';
import { parseActionPolicy } from '../../infrastructure/helpers/policy/parser';
import { isCheckOnlyPolicy, isNoOpPolicy } from '../../infrastructure/helpers/policy/utils';

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
    if (!target) { return; }

    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    
    // Get all entries in this folder (files AND folders)
    const diff = state.getDiffEntries(workspaceId);
    const filesToDelete: RelPath[] = [];
    const foldersToDelete: RelPath[] = [];
    
    for (const [p, e] of diff.entries()) {
      const inFolder = folderPath === '' 
        ? true 
        : (p as string).startsWith((folderPath as string) + '/') || p === folderPath;
      
      if (inFolder) {
        if (e.type === 'file') {
          filesToDelete.push(p);
        } else if (e.type === 'folder') {
          foldersToDelete.push(p);
        }
      }
    }

    if (filesToDelete.length === 0 && foldersToDelete.length === 0) {
      await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
      void vscode.window.showInformationMessage('LiveSync: no items to delete');
      return;
    }
    
    const folderName = folderPath === '' ? 'workspace' : folderPath;
    const totalItems = filesToDelete.length + foldersToDelete.length;

    // Confirm (skip in test mode)
    if (!isTestMode()) {
      // Confirm deletion
      const confirmation = await vscode.window.showWarningMessage(
        `Delete ${totalItems} item(s) from both local and remote under ${folderName}?`,
        'Delete'
      );

      if (confirmation !== 'Delete') {return;}
    }

    // Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnDelete);
    
    if (isNoOpPolicy(policy)) {return;}

    // Handle check-only policy
    if (isCheckOnlyPolicy(policy)) {
      void vscode.window.showInformationMessage('LiveSync: check-only mode, no upload performed.');
      return;
    }

    // Batch delete with progress
    const limit = pLimit(BATCH_CONCURRENCY);
    let completed = 0;
    let lastProgressUpdate = Date.now();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LiveSync: Deleting items',
        cancellable: false
      },
      async (progress) => {
        // Step 1: Delete all files first (both local and remote)
        const fileTasks = filesToDelete.map((relPath) =>
          limit(async () => {
            try {
              const absPath = absFs(workspaceId, relPath);
              const uri = vscode.Uri.file(absPath);
              
              // Delete locally
              try {
                await vscode.workspace.fs.delete(uri);
              } catch (err) {
                // File might not exist locally, that's ok
                logExpectedError(`deleteFolder:local:${relPath}`, err);
              }
              
              // Delete remotely
              try {
                await remote.deletePath(workspaceId, relPath);
              } catch (err) {
                // File might not exist remotely, that's ok
                logExpectedError(`deleteFolder:remote:${relPath}`, err);
              }
              
              // Remove from all three snapshots
              state.applyLocal({ workspaceId, type: 'delete', path: relPath });
              state.applyRemote({ workspaceId, type: 'delete', path: relPath });
              state.applyBase({ workspaceId, type: 'delete', path: relPath });
              
              completed++;

              const now = Date.now();
              if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
                progress.report({
                  message: `${completed}/${totalItems} items`,
                  increment: (100 / totalItems)
                });
                lastProgressUpdate = now;
              }
            } catch (err) {
              logExpectedError(`deleteFolder:file:${relPath}`, err);
            }
          })
        );

        await Promise.all(fileTasks);

        // Step 2: Delete folders (sort by depth, deepest first)
        const sortedFolders = foldersToDelete.sort((a, b) => {
          const depthA = (a as string).split('/').length;
          const depthB = (b as string).split('/').length;
          return depthB - depthA;  // Deepest first
        });

        const folderTasks = sortedFolders.map((relPath) =>
          limit(async () => {
            try {
              const absPath = absFs(workspaceId, relPath);
              const uri = vscode.Uri.file(absPath);
              
              // Delete locally (recursive, will delete any remaining contents)
              try {
                await vscode.workspace.fs.delete(uri, { recursive: true });
              } catch (err) {
                // Folder might not exist locally, that's ok
                logExpectedError(`deleteFolder:local:${relPath}`, err);
              }
              
              // Delete remotely
              try {
                await remote.deletePath(workspaceId, relPath);
              } catch (err) {
                // Folder might not exist remotely, that's ok
                logExpectedError(`deleteFolder:remote:${relPath}`, err);
              }
              
              // Remove from all three snapshots
              state.applyLocal({ workspaceId, type: 'delete', path: relPath });
              state.applyRemote({ workspaceId, type: 'delete', path: relPath });
              state.applyBase({ workspaceId, type: 'delete', path: relPath });
              
              completed++;

              const now = Date.now();
              if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
                progress.report({
                  message: `${completed}/${totalItems} items`,
                  increment: (100 / totalItems)
                });
                lastProgressUpdate = now;
              }
            } catch (err) {
              logExpectedError(`deleteFolder:folder:${relPath}`, err);
            }
          })
        );

        await Promise.all(folderTasks);

        progress.report({ message: `${completed}/${totalItems} items`, increment: 100 });
      }
    );

    // Refresh after batch delete
    await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
    void vscode.window.showInformationMessage(`LiveSync: Deleted ${completed} item(s)`);
  });
}