import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { resolveEntryTarget, resolveFolderTarget } from '@infra/helpers/resolve';
import type { RelPath, WorkspaceId } from '@domain/types';
import { absFs, pathToString, stringToWsId } from '@helpers/path';
import { isDownloadable, isUploadable } from '@helpers/diff';
import { requireValidRemoteConfig } from '@infra/helpers/config';
import { parseActionPolicy } from '@helpers/policy/parser';
import pLimit from 'p-limit';

// New helper imports (same as FileEventBridge)
import { ensureFreshRemoteSnapshot } from '@helpers/snapshot';
import { detectConflict } from '@helpers/conflict/detector';
import { resolveConflict, showCheckInfo } from '@helpers/conflict/resolver';
import { isCheckOnlyPolicy, isNoOpPolicy, requiresRemoteSnapshot } from '@helpers/policy/utils';
import { markConflictIgnored, clearIgnoredConflictIfResolved } from '@helpers/conflict/tracker';
import { executeUpload, executeDownload } from '@helpers/action/executor';
import { notifySuccess, notifyError } from '@helpers/notification';
import { logExpectedError, logSync } from '@helpers/logging';
import { isTestMode } from '../../infrastructure/helpers/test';
import { getFolderLabel } from '../../infrastructure/helpers/workspaceFolder';

// Concurrency limits
const BATCH_CONCURRENCY = 25; // For folder upload/download commands
const PROGRESS_THROTTLE_MS = 250; // Report progress max 4x per second (smooth animation)

/**
 * Register all upload/download commands.
 */
export function registerUploadDownload(services: Services): void {
  const { context, state, config, provider, remote, notifications, progress } = services;

  // ═══════════════════════════════════════════════════════════════════════════
  // Single File Upload
  // ═══════════════════════════════════════════════════════════════════════════
  cmd(context, 'livesync.upload', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) return;
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Validate entry is uploadable
    if (entry && entry.type !== 'file') return;
    if (entry && !isUploadable(entry.status)) return;

    // Use command handler
    await handleFileCommand('upload', workspaceId, relPath, 'actionOnUpload', services);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Single File Download
  // ═══════════════════════════════════════════════════════════════════════════
  cmd(context, 'livesync.download', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) return;

    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Validate entry is downloadable
    if (entry && entry.type !== 'file') return;
    if (entry && !isDownloadable(entry.status)) return;

    // Use command handler
    await handleFileCommand('download', workspaceId, relPath, 'actionOnDownload', services);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Upload (Streaming with Throttled Progress + Cancellation)
  // ═══════════════════════════════════════════════════════════════════════════
  cmd(context, 'livesync.uploadFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) return;
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect uploadable files
    const toUpload: Array<{ relPath: RelPath; absLocal: string }> = [];
    const prefix = pathToString(folderPath);
    
    for (const [p, e] of diff.entries()) {
      // Check if file is in this folder (empty prefix = root, include all)
      const inFolder = !prefix || (p as string).startsWith(prefix + '/');
      
      if (!inFolder) continue;
      if (e.type !== 'file') continue;
      if (isUploadable(e.status)) {
        toUpload.push({ relPath: p, absLocal: absFs(workspaceId, p) });
      }
    }

    if (toUpload.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no items to upload.');
      return;
    }

    // Confirm (skip in test mode)
    if (!isTestMode()) {
      const label = getFolderLabel(workspaceId, folderPath);
      const confirmed = await vscode.window.showWarningMessage(
        `Upload ${toUpload.length} file(s) under "${label}"?`,
        'Upload'
      );
      if (confirmed !== 'Upload') return;
    }

    // Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnUpload);
    
    if (isNoOpPolicy(policy)) return;

    // Handle check-only policy
    if (isCheckOnlyPolicy(policy)) {
      void vscode.window.showInformationMessage('LiveSync: check-only mode, no upload performed.');
      return;
    }
    
    // ⚡ FAST UPLOAD with Throttled Progress + Cancellation Support
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uploading ${toUpload.length} files`,
          cancellable: true // Enable cancel button
        },
        async (progress, token) => {
          const limit = pLimit(BATCH_CONCURRENCY);
          let completed = 0;
          let cancelled = false;
          let lastReportTime = 0;
          const errors: Array<{ relPath: RelPath; error: string }> = [];

          // Listen for cancellation
          token.onCancellationRequested(() => {
            cancelled = true;
          });

          const uploadPromises = toUpload.map(file => limit(async () => {
            // Check if cancelled before starting this file
            if (cancelled) return;

            try {
              // Upload file (no snapshot sync for speed)
              await remote.uploadFile(workspaceId, file.relPath, file.absLocal);
              
              completed++;
              
              // Throttled progress reporting (smooth animation)
              const now = Date.now();
              if (now - lastReportTime > PROGRESS_THROTTLE_MS || completed === toUpload.length) {
                progress.report({
                  message: `${completed}/${toUpload.length}`,
                  increment: ((completed / toUpload.length) * 100) - ((completed - 1) / toUpload.length) * 100
                });
                lastReportTime = now;
              }
              
              logSync(stringToWsId(workspaceId), 'upload', file.relPath as string);
              
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              errors.push({ relPath: file.relPath, error: errorMsg });
              logExpectedError(`uploadFolder:${file.relPath}`, err);
            }
          }));

          // Wait for all uploads (or cancellation)
          await Promise.all(uploadPromises);

          // Handle cancellation
          if (cancelled) {
            void vscode.window.showWarningMessage(
              `LiveSync: upload cancelled. Uploaded ${completed}/${toUpload.length} file(s).`
            );
          } else if (errors.length > 0) {
            console.warn(`LiveSync: ${errors.length} file(s) failed to upload`);
            void vscode.window.showWarningMessage(
              `LiveSync: uploaded ${completed - errors.length}/${toUpload.length} file(s). ${errors.length} failed.`
            );
          } else {
            void vscode.window.showInformationMessage(
              `LiveSync: uploaded ${completed} file(s).`
            );
          }

          // Always refresh to ensure correct state
          void vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
        }
      );
      
      // Cleanup - mark resolved
      provider.markRecentlyResolvedBatch(
        stringToWsId(workspaceId), 
        toUpload.map(f => f.relPath)
      );
      
      for (const { relPath } of toUpload) {
        clearIgnoredConflictIfResolved(state, workspaceId, relPath);
      }
      
    } catch (err) {
      logExpectedError(`uploadFolder:${folderPath}`, err);
      void vscode.window.showErrorMessage(`LiveSync: failed to upload folder`);
      
      // Refresh on error to ensure correct state
      void vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Download (Streaming with Throttled Progress + Cancellation)
  // ═══════════════════════════════════════════════════════════════════════════
  cmd(context, 'livesync.downloadFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) return;
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect downloadable files
    const toDownload: Array<{ relPath: RelPath; absLocal: string }> = [];
    const prefix = pathToString(folderPath);
    
    for (const [p, e] of diff.entries()) {
      // Check if file is in this folder (empty prefix = root, include all)
      const inFolder = !prefix || (p as string).startsWith(prefix + '/');
      
      if (!inFolder) continue;
      if (e.type !== 'file') continue;
      if (isDownloadable(e.status)) {
        toDownload.push({ relPath: p, absLocal: absFs(workspaceId, p) });
      }
    }

    if (toDownload.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no items to download.');
      return;
    }

    // Confirm (skip in test mode)
    if (!isTestMode()) {
      const label = getFolderLabel(workspaceId, folderPath);
      const confirmed = await vscode.window.showWarningMessage(
        `Download ${toDownload.length} file(s) under "${label}"?`,
        'Download'
      );
      if (confirmed !== 'Download') return;
    }

    // Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnDownload);
    
    if (isNoOpPolicy(policy)) return;

    // Handle check-only policy
    if (isCheckOnlyPolicy(policy)) {
      void vscode.window.showInformationMessage('LiveSync: check-only mode, no download performed.');
      return;
    }
    
    // ⚡ FAST DOWNLOAD with Throttled Progress + Cancellation Support
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading ${toDownload.length} files`,
          cancellable: true // Enable cancel button
        },
        async (progress, token) => {
          const limit = pLimit(BATCH_CONCURRENCY);
          let completed = 0;
          let cancelled = false;
          let lastReportTime = 0;
          const errors: Array<{ relPath: RelPath; error: string }> = [];

          // Listen for cancellation
          token.onCancellationRequested(() => {
            cancelled = true;
          });

          const downloadPromises = toDownload.map(file => limit(async () => {
            // Check if cancelled before starting this file
            if (cancelled) return;

            try {
              // Download file (no snapshot sync for speed)
              await remote.downloadFile(workspaceId, file.relPath, file.absLocal);
              
              completed++;
              
              // Throttled progress reporting (smooth animation)
              const now = Date.now();
              if (now - lastReportTime > PROGRESS_THROTTLE_MS || completed === toDownload.length) {
                progress.report({
                  message: `${completed}/${toDownload.length}`,
                  increment: ((completed / toDownload.length) * 100) - ((completed - 1) / toDownload.length) * 100
                });
                lastReportTime = now;
              }
              
              logSync(stringToWsId(workspaceId), 'download', file.relPath as string);
              
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              errors.push({ relPath: file.relPath, error: errorMsg });
              logExpectedError(`downloadFolder:${file.relPath}`, err);
            }
          }));

          // Wait for all downloads (or cancellation)
          await Promise.all(downloadPromises);

          // Handle cancellation
          if (cancelled) {
            void vscode.window.showWarningMessage(
              `LiveSync: download cancelled. Downloaded ${completed}/${toDownload.length} file(s).`
            );
          } else if (errors.length > 0) {
            console.warn(`LiveSync: ${errors.length} file(s) failed to download`);
            void vscode.window.showWarningMessage(
              `LiveSync: downloaded ${completed - errors.length}/${toDownload.length} file(s). ${errors.length} failed.`
            );
          } else {
            void vscode.window.showInformationMessage(
              `LiveSync: downloaded ${completed} file(s).`
            );
          }

          // Always refresh to ensure correct state
          void vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
        }
      );
      
      // Cleanup - mark resolved
      provider.markRecentlyResolvedBatch(
        stringToWsId(workspaceId), 
        toDownload.map(f => f.relPath)
      );
      
      for (const { relPath } of toDownload) {
        clearIgnoredConflictIfResolved(state, workspaceId, relPath);
      }
      
    } catch (err) {
      logExpectedError(`downloadFolder:${folderPath}`, err);
      void vscode.window.showErrorMessage(`LiveSync: failed to download folder`);
      
      // Refresh on error to ensure correct state
      void vscode.commands.executeCommand('livesync.refresh', { workspaceId, folderPath });
    }
  });
}

/**
 * Shared handler for single-file upload/download commands.
 * Implements the complete workflow:
 * 1. Parse policy
 * 2. Get remote snapshot if needed
 * 3. Detect conflicts
 * 4. Resolve conflicts (or check-only)
 * 5. Execute action
 * 6. Notify user
 * 7. Cleanup
 */
async function handleFileCommand(
  operation: 'upload' | 'download',
  workspaceId: WorkspaceId,
  relPath: RelPath,
  policyKey: 'actionOnUpload' | 'actionOnDownload',
  services: Services
): Promise<boolean> {
  const { state, config, remote, notifications, provider } = services;
  
  try {
    // 1. Get policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data[policyKey]);
    
    if (isNoOpPolicy(policy)) return false;
    
    // 2. Ensure remote snapshot if policy requires it
    if (requiresRemoteSnapshot(policy)) {
      await ensureFreshRemoteSnapshot(state, remote, workspaceId);
    }
    
    // 3. Detect conflicts
    // Use 'save' for upload, 'open' for download (matches event semantics)
    const eventType = operation === 'upload' ? 'save' : 'open';
    const conflict = detectConflict(eventType, workspaceId, relPath, state);
    
    if (conflict) {
      // 4a. Resolve conflict (or check-only)
      if (isCheckOnlyPolicy(policy)) {
        showCheckInfo(conflict);
        markConflictIgnored(state, workspaceId, relPath, conflict);
        return false;
      }
      
      const resolved = await resolveConflict(conflict, workspaceId, relPath);
      if (!resolved) {
        markConflictIgnored(state, workspaceId, relPath, conflict);
        return false;
      }
    } else if (isCheckOnlyPolicy(policy)) {
      // 4b. Check-only with no conflict
      void vscode.window.showInformationMessage('LiveSync: no conflict detected.');
      return false;
    }
    
    // 5. Log operation start
    logSync(stringToWsId(workspaceId), operation, relPath as string, 'starting');
    
    // 6. Execute action
    if (operation === 'upload') {
      await executeUpload(remote, state, workspaceId, relPath);
    } else {
      await executeDownload(remote, state, workspaceId, relPath);
    }
    
    // 7. Log completion
    logSync(stringToWsId(workspaceId), operation, relPath as string, 'completed');
    
    // 8. Notify & cleanup
    notifySuccess(notifications, operation, relPath);
    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [relPath]);
    clearIgnoredConflictIfResolved(state, workspaceId, relPath);
    
    return true;
  } catch (err) {
    logExpectedError(`${operation}:${relPath}`, err);
    notifyError(notifications, operation, relPath);
    return false;
  }
}