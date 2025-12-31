import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { resolveEntryTarget, resolveFolderTarget } from '@infra/helpers/resolve';
import type { RelPath } from '@domain/types';
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

/**
 * Register all upload/download commands.
 */
export function registerUploadDownload(services: Services): void {
  const { context, state, config, provider, remote, notifications } = services;

  // ─────────────────────────────────────────────────────────────────────────────
  // Single file upload
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.upload', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) return;
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Check if entry is uploadable
    if (entry && entry.type !== 'file') return;
    if (entry && !isUploadable(entry.status)) return;

    // 1. Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnUpload);
    
    if (isNoOpPolicy(policy)) return;
    
    // 2. Refresh remote snapshot (if needed)
    if (requiresRemoteSnapshot(policy)) {
      await ensureFreshRemoteSnapshot(state, remote, workspaceId, relPath);
    }
    
    // 3. Detect conflict
    let conflict = null;
    if (policy.check) {
      conflict = detectConflict('save', workspaceId, relPath, state);
    }
    
    // 4. Handle check-only
    if (isCheckOnlyPolicy(policy)) {
      showCheckInfo(conflict);
      return;
    }
    
    // 5. Resolve conflict
    if (conflict) {
      const resolution = await resolveConflict(conflict, workspaceId, relPath);
      
      if (resolution.action === 'cancel') {
        return;
      }
      
      if (resolution.action === 'ignore') {
        markConflictIgnored(state, workspaceId, relPath, conflict);
        return;
      }
    }
    
    // 6. Execute action
    try {
      await executeUpload(remote, state, workspaceId, relPath);
      notifySuccess(notifications, 'upload', relPath);
      
      // Mark as resolved for UI
      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [relPath]);
      
      // Clear ignored conflict
      clearIgnoredConflictIfResolved(state, workspaceId, relPath);
    } catch (err) {
      logExpectedError(`upload:${relPath}`, err);
      notifyError(notifications, 'upload', relPath);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Single file download
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.download', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) return;

    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Check if entry is downloadable
    if (entry && entry.type !== 'file') return;
    if (entry && !isDownloadable(entry.status)) return;

    // 1. Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnDownload);
    
    if (isNoOpPolicy(policy)) return;
    
    // 2. Refresh remote snapshot (if needed)
    if (requiresRemoteSnapshot(policy)) {
      await ensureFreshRemoteSnapshot(state, remote, workspaceId, relPath);
    }
    
    // 3. Detect conflict
    let conflict = null;
    if (policy.check) {
      conflict = detectConflict('open', workspaceId, relPath, state);
    }
    
    // 4. Handle check-only
    if (isCheckOnlyPolicy(policy)) {
      showCheckInfo(conflict);
      return;
    }
    
    // 5. Resolve conflict
    if (conflict) {
      const resolution = await resolveConflict(conflict, workspaceId, relPath);
      
      if (resolution.action === 'cancel') {
        return;
      }
      
      if (resolution.action === 'ignore') {
        markConflictIgnored(state, workspaceId, relPath, conflict);
        return;
      }
    }
    
    // 6. Execute action
    try {
      await executeDownload(remote, state, workspaceId, relPath);
      notifySuccess(notifications, 'download', relPath);
      
      // Mark as resolved for UI
      provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [relPath]);
      
      // Clear ignored conflict
      clearIgnoredConflictIfResolved(state, workspaceId, relPath);
    } catch (err) {
      logExpectedError(`download:${relPath}`, err);
      notifyError(notifications, 'download', relPath);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder upload (batch)
  // ─────────────────────────────────────────────────────────────────────────────
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
    for (const [p, e] of diff.entries()) {
      if (!(p as string).startsWith(folderPath as string)) continue;
      if (e.type !== 'file') continue;
      if (isUploadable(e.status)) {
        toUpload.push({ relPath: p, absLocal: absFs(workspaceId, p) });
      }
    }

    if (toUpload.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no items to upload.');
      return;
    }

    // Always confirm for folder operations
    const label = relToString(folderPath) || '.';
    const confirmed = await vscode.window.showWarningMessage(
      `Upload ${toUpload.length} file(s) under "${label}"?`,
      'Upload'
    );
    if (confirmed !== 'Upload') return;

    // 1. Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnUpload);
    
    if (isNoOpPolicy(policy)) return;
    
    // Note: For folder operations, we skip conflict detection
    // since we already confirmed with user and they can see the diff tree
    
    // 2. Execute batch upload
    try {
      await executeUploadFolder(remote, state, workspaceId, toUpload);
      
      // Mark all as resolved for UI
      provider.markRecentlyResolvedBatch(
        stringToWsId(workspaceId), 
        toUpload.map(f => f.relPath)
      );
      
      // Clear any ignored conflicts for uploaded files
      for (const { relPath } of toUpload) {
        clearIgnoredConflictIfResolved(state, workspaceId, relPath);
      }
      
      void vscode.window.showInformationMessage(`LiveSync: uploaded ${toUpload.length} file(s).`);
    } catch (err) {
      logExpectedError(`uploadFolder:${folderPath}`, err);
      void vscode.window.showErrorMessage(`LiveSync: failed to upload folder`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder download (batch)
  // ─────────────────────────────────────────────────────────────────────────────
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
    for (const [p, e] of diff.entries()) {
      if (!(p as string).startsWith(folderPath as string)) continue;
      if (e.type !== 'file') continue;
      if (isDownloadable(e.status)) {
        toDownload.push({ relPath: p, absLocal: absFs(workspaceId, p) });
      }
    }

    if (toDownload.length === 0) {
      void vscode.window.showInformationMessage('LiveSync: no items to download.');
      return;
    }

    // Always confirm for folder operations
    const label = relToString(folderPath) || '.';
    const confirmed = await vscode.window.showWarningMessage(
      `Download ${toDownload.length} file(s) under "${label}"?`,
      'Download'
    );
    if (confirmed !== 'Download') return;

    // 1. Parse policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnDownload);
    
    if (isNoOpPolicy(policy)) return;
    
    // Note: For folder operations, we skip conflict detection
    // since we already confirmed with user and they can see the diff tree
    
    // 2. Execute batch download
    try {
      await executeDownloadFolder(remote, state, workspaceId, toDownload);
      
      // Mark all as resolved for UI
      provider.markRecentlyResolvedBatch(
        stringToWsId(workspaceId), 
        toDownload.map(f => f.relPath)
      );
      
      // Clear any ignored conflicts for downloaded files
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