import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { resolveEntryTarget, resolveFolderTarget } from '@infra/helpers/resolve';
import type { RelPath, WorkspaceId } from '@domain/types';
import { absFs, relToString, stringToWsId } from '@helpers/path';
import { isDownloadable, isUploadable } from '@helpers/diff';
import { requireValidRemoteConfig } from '@infra/helpers/config';
import { parseActionPolicy } from '@helpers/policy/parser';

// New helper imports (same as FileEventBridge)
import { ensureFreshRemoteSnapshot } from '@helpers/snapshot';
import { detectConflict } from '@helpers/conflict/detector';
import { resolveConflict, showCheckInfo } from '@helpers/conflict/resolver';
import { isCheckOnlyPolicy, isNoOpPolicy, requiresRemoteSnapshot } from '@helpers/policy/utils';
import { markConflictIgnored, clearIgnoredConflictIfResolved } from '@helpers/conflict/tracker';
import { executeUpload, executeDownload, executeUploadFolder, executeDownloadFolder } from '@helpers/action/executor';
import { notifySuccess, notifyError } from '@helpers/notification';
import { logExpectedError } from '@helpers/logging';
import { isTestMode } from '../../infrastructure/helpers/test';
import { getFolderLabel } from '../../infrastructure/helpers/workspaceFolder';

/**
 * Register all upload/download commands.
 */
export function registerUploadDownload(services: Services): void {
  const { context, state, config, provider, remote } = services;

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
  // Folder Upload (Batch)
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
    const prefix = relToString(folderPath);
    
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
    
    // Execute batch upload (skip conflict detection for folders)
    try {
      await executeUploadFolder(remote, state, workspaceId, toUpload);
      
      // Cleanup
      provider.markRecentlyResolvedBatch(
        stringToWsId(workspaceId), 
        toUpload.map(f => f.relPath)
      );
      
      for (const { relPath } of toUpload) {
        clearIgnoredConflictIfResolved(state, workspaceId, relPath);
      }
      
      void vscode.window.showInformationMessage(`LiveSync: uploaded ${toUpload.length} file(s).`);
    } catch (err) {
      logExpectedError(`uploadFolder:${folderPath}`, err);
      void vscode.window.showErrorMessage(`LiveSync: failed to upload folder`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Folder Download (Batch)
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
    const prefix = relToString(folderPath);
    
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
      void vscode.window.showInformationMessage('LiveSync: check-only mode, no upload performed.');
      return;
    }
    
    // Execute batch download (skip conflict detection for folders)
    try {
      await executeDownloadFolder(remote, state, workspaceId, toDownload);
      
      // Cleanup
      provider.markRecentlyResolvedBatch(
        stringToWsId(workspaceId), 
        toDownload.map(f => f.relPath)
      );
      
      for (const { relPath } of toDownload) {
        clearIgnoredConflictIfResolved(state, workspaceId, relPath);
      }
      
      void vscode.window.showInformationMessage(`LiveSync: downloaded ${toDownload.length} file(s).`);
    } catch (err) {
      logExpectedError(`downloadFolder:${folderPath}`, err);
      void vscode.window.showErrorMessage(`LiveSync: failed to download folder`);
    }
  });
}

/**
 * Handle upload/download commands (NOT events)
 * 
 * @param operation - 'upload' or 'download'
 * @param workspaceId - Target workspace
 * @param relPath - File to upload/download
 * @param policyKey - Config key for policy
 * @param services - Extension services
 * @returns true if action executed, false if skipped/cancelled
 */
async function handleFileCommand(
  operation: 'upload' | 'download',
  workspaceId: WorkspaceId,
  relPath: RelPath,
  policyKey: 'actionOnUpload' | 'actionOnDownload',
  services: Services
): Promise<boolean> {
  const { state, config, remote, provider, notifications } = services;

  try {
    // 1. Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data[policyKey]);
    
    if (isNoOpPolicy(policy)) {
      return false;
    }
    
    // 2. Refresh remote snapshot (if needed)
    if (requiresRemoteSnapshot(policy)) {
      await ensureFreshRemoteSnapshot(state, remote, workspaceId, relPath);
    }
    
    // 3. Detect conflict
    let conflict = null;
    if (policy.check) {
      // Use 'save' for upload, 'open' for download (matches event semantics)
      const eventType = operation === 'upload' ? 'save' : 'open';
      conflict = detectConflict(eventType, workspaceId, relPath, state);
    }
    
    // 4. Handle check-only
    if (isCheckOnlyPolicy(policy)) {
      showCheckInfo(conflict);
      return false;
    }
    
    // 5. Resolve conflict
    if (conflict) {
      const resolution = await resolveConflict(conflict, workspaceId, relPath);
      
      if (resolution.action === 'cancel') {
        return false;
      }
      
      if (resolution.action === 'ignore') {
        markConflictIgnored(state, workspaceId, relPath, conflict);
        return false;
      }
      
      // If 'diff' was shown, we still proceed after showing it
    }
    
    // 6. Execute action
    if (operation === 'upload') {
      await executeUpload(remote, state, workspaceId, relPath);
    } else {
      await executeDownload(remote, state, workspaceId, relPath);
    }
    
    // 7. Notify & cleanup
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