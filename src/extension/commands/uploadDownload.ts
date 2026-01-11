/**
 * Upload/Download Commands
 * 
 * Single file and folder upload/download commands.
 * Single file commands now use unified handleAction().
 */

import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { resolveEntryTarget, resolveFolderTarget } from '@infra/helpers/resolve';
import type { RelPath } from '@domain/types';
import { absFs, stringToWsId } from '@helpers/path';
import { isDownloadable, isUploadable } from '@helpers/diff';
import { requireValidRemoteConfig } from '@infra/helpers/config';
import pLimit from 'p-limit';
import { handleAction } from '@helpers/action/handler';
import { logExpectedError } from '@helpers/logging';

// Concurrency limits
const BATCH_CONCURRENCY = 25;
const PROGRESS_THROTTLE_MS = 250;

/**
 * Register all upload/download commands
 */
export function registerUploadDownload(services: Services): void {
  const { context, state, config, provider, remote, validator, notifications } = services;

  // ═══════════════════════════════════════════════════════════════════════════
  // Single File Upload
  // ═══════════════════════════════════════════════════════════════════════════
  
  cmd(context, 'livesync.upload', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) {return;}
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Validate entry is uploadable
    if (entry && entry.type !== 'file') {return;}
    if (entry && !isUploadable(entry.status)) {return;}

    // Capture metas
    const oldLocalMeta = state.getLocalMeta(workspaceId, relPath);
    const oldRemoteMeta = state.getRemoteMeta(workspaceId, relPath);
    const actualLocalMeta = state.getLocalMeta(workspaceId, relPath);
    
    // Call unified handler
    await handleAction({
      workspaceId,
      relPath,
      policyKey: 'actionOnUpload',
      operation: 'save',  // Upload uses save conflict detection
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
  // Single File Download
  // ═══════════════════════════════════════════════════════════════════════════
  
  cmd(context, 'livesync.download', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) {return;}
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Validate entry is downloadable
    if (entry && entry.type !== 'file') {return;}
    if (entry && !isDownloadable(entry.status)) {return;}

    // Capture metas
    const oldLocalMeta = state.getLocalMeta(workspaceId, relPath);
    const oldRemoteMeta = state.getRemoteMeta(workspaceId, relPath);
    const actualLocalMeta = state.getLocalMeta(workspaceId, relPath);
    
    // Call unified handler
    await handleAction({
      workspaceId,
      relPath,
      policyKey: 'actionOnDownload',
      operation: 'open',  // Download uses open conflict detection
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
  // Folder Upload (batch)
  // ═══════════════════════════════════════════════════════════════════════════
  
  cmd(context, 'livesync.uploadFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) {return;}

    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);
    
    // Collect uploadable files in this folder
    const toUpload: Array<{ relPath: RelPath; absLocal: string }> = [];
    
    for (const [p, e] of diff.entries()) {
      const inFolder = folderPath === '' 
        ? true 
        : (p as string).startsWith((folderPath as string) + '/');
      
      if (!inFolder) {continue;}
      if (e.type !== 'file') {continue;}
      if (isUploadable(e.status)) {
        toUpload.push({ relPath: p, absLocal: absFs(workspaceId, p) });
      }
    }

    if (toUpload.length === 0) {
      // Refresh before showing message
      await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
      void vscode.window.showInformationMessage('LiveSync: no items to upload.');
      return;
    }

    // Batch upload with progress
    const limit = pLimit(BATCH_CONCURRENCY);
    let completed = 0;
    let lastProgressUpdate = Date.now();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LiveSync: Uploading files',
        cancellable: false
      },
      async (progress) => {
        const tasks = toUpload.map((item) =>
          limit(async () => {
            try {
              await remote.uploadFile(workspaceId, item.relPath, item.absLocal);
              completed++;

              const now = Date.now();
              if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
                progress.report({
                  message: `${completed}/${toUpload.length} files`,
                  increment: (100 / toUpload.length)
                });
                lastProgressUpdate = now;
              }
            } catch (err) {
              logExpectedError(`uploadFolder:${item.relPath}`, err);
            }
          })
        );

        await Promise.all(tasks);
        progress.report({ message: `${completed}/${toUpload.length} files`, increment: 100 });
      }
    );

    // Refresh after batch upload
    await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
    void vscode.window.showInformationMessage(`LiveSync: Uploaded ${completed} file(s)`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Download (batch)
  // ═══════════════════════════════════════════════════════════════════════════
  
  cmd(context, 'livesync.downloadFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) {return;}

    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);
    
    // Collect downloadable files in this folder
    const toDownload: Array<{ relPath: RelPath; absLocal: string }> = [];
    
    for (const [p, e] of diff.entries()) {
      const inFolder = folderPath === '' 
        ? true 
        : (p as string).startsWith((folderPath as string) + '/');
      
      if (!inFolder) {continue;}
      if (e.type !== 'file') {continue;}
      if (isDownloadable(e.status)) {
        toDownload.push({ relPath: p, absLocal: absFs(workspaceId, p) });
      }
    }

    if (toDownload.length === 0) {
      // Refresh before showing message
      await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
      void vscode.window.showInformationMessage('LiveSync: no items to download.');
      return;
    }

    // Batch download with progress
    const limit = pLimit(BATCH_CONCURRENCY);
    let completed = 0;
    let lastProgressUpdate = Date.now();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LiveSync: Downloading files',
        cancellable: false
      },
      async (progress) => {
        const tasks = toDownload.map((item) =>
          limit(async () => {
            try {
              await remote.downloadFile(workspaceId, item.relPath, item.absLocal);
              completed++;

              const now = Date.now();
              if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
                progress.report({
                  message: `${completed}/${toDownload.length} files`,
                  increment: (100 / toDownload.length)
                });
                lastProgressUpdate = now;
              }
            } catch (err) {
              logExpectedError(`downloadFolder:${item.relPath}`, err);
            }
          })
        );

        await Promise.all(tasks);
        progress.report({ message: `${completed}/${toDownload.length} files`, increment: 100 });
      }
    );

    // Refresh after batch download
    await vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
    void vscode.window.showInformationMessage(`LiveSync: Downloaded ${completed} file(s)`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Upload/Download Workspace (delegates to folder commands)
  // ═══════════════════════════════════════════════════════════════════════════
  
  cmd(context, 'livesync.uploadWorkspace', async () => {
    const currentWsId = provider.getCurrentWorkspace();
    if (!currentWsId) {
      void vscode.window.showWarningMessage('LiveSync: no workspace selected.');
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.find(
      f => stringToWsId(f.uri.fsPath) === currentWsId
    );
    
    if (!folder) {
      void vscode.window.showWarningMessage('LiveSync: workspace folder not found.');
      return;
    }

    await vscode.commands.executeCommand('livesync.uploadFolder', folder.uri);
  });

  cmd(context, 'livesync.downloadWorkspace', async () => {
    const currentWsId = provider.getCurrentWorkspace();
    if (!currentWsId) {
      void vscode.window.showWarningMessage('LiveSync: no workspace selected.');
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.find(
      f => stringToWsId(f.uri.fsPath) === currentWsId
    );
    
    if (!folder) {
      void vscode.window.showWarningMessage('LiveSync: workspace folder not found.');
      return;
    }

    await vscode.commands.executeCommand('livesync.downloadFolder', folder.uri);
  });
}