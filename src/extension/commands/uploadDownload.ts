import * as vscode from 'vscode';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { resolveEntryTarget, resolveFolderTarget } from '@infra/helpers/resolve';
import type { RelPath } from '@domain/types';
import { absFs, relToString, stringToWsId } from '@helpers/path';
import { isDownloadable, isUploadable } from '@helpers/diff';
import { requireValidRemoteConfig } from '@infra/helpers/config';
import { maybeActByPolicy, parseActionPolicy } from '@infra/helpers/policy';

/**
 * Register all upload/download commands.
 * Uses centralized policy helpers and folder methods for consistency.
 */
export function registerUploadDownload(services: Services): void {
  const { context, state, config, provider } = services;

  // ─────────────────────────────────────────────────────────────────────────────
  // Single file upload
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.upload', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) { return; }
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Check if entry is uploadable
    if (entry && entry.type !== 'file') { return; }
    if (entry && !isUploadable(entry.status)) { return; }

    // Get policy and use centralized helper
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnUpload);
    
    await maybeActByPolicy(
      workspaceId, 
      relPath, 
      policy, 
      'upload', 
      state, 
      services.remote,
      'file',
      undefined,
      false
    );

    // Mark as resolved for UI
    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [relPath]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Single file download
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.download', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg);
    if (!target) { return; }

    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, relPath } = target;
    const entry = state.getDiffEntry(workspaceId, relPath);

    // Check if entry is downloadable
    if (entry && entry.type !== 'file') { return; }
    if (entry && !isDownloadable(entry.status)) { return; }

    // Get policy and use centralized helper
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnDownload);
    
    await maybeActByPolicy(
      workspaceId, 
      relPath, 
      policy, 
      'download', 
      state, 
      services.remote,
      'file',
      undefined,
      false
    );

    // Mark as resolved for UI
    provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [relPath]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder upload (batch)
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.uploadFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) { return; }
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect uploadable files
    const toUpload: Array<{ relPath: RelPath; absLocal: string }> = [];
    for (const [p, e] of diff.entries()) {
      if (!(p as string).startsWith(folderPath as string)) { continue; }
      if (e.type !== 'file') { continue; }
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
    if (confirmed !== 'Upload') { return; }

    // Get policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnUpload);

    // Use centralized helper with folder mode
    await maybeActByPolicy(
      workspaceId,
      folderPath,
      policy,
      'upload',
      state,
      services.remote,
      'folder',
      toUpload
    );

    provider.markRecentlyResolvedBatch(
      stringToWsId(workspaceId), 
      toUpload.map(f => f.relPath)
    );
    void vscode.window.showInformationMessage(`LiveSync: uploaded ${toUpload.length} file(s).`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Folder download (batch)
  // ─────────────────────────────────────────────────────────────────────────────
  cmd(context, 'livesync.downloadFolder', async (arg?: unknown) => {
    const target = resolveFolderTarget(arg);
    if (!target) { return; }
    
    if (!await requireValidRemoteConfig(services, target.workspaceId)) {
      return;
    }

    const { workspaceId, folderPath } = target;
    const diff = state.getDiffEntries(workspaceId);

    // Collect downloadable files
    const toDownload: Array<{ relPath: RelPath; absLocal: string }> = [];
    for (const [p, e] of diff.entries()) {
      if (!(p as string).startsWith(folderPath as string)) { continue; }
      if (e.type !== 'file') { continue; }
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
    if (confirmed !== 'Download') { return; }

    // Get policy
    const cfg = await config.getById(workspaceId);
    const policy = parseActionPolicy(cfg.data.actionOnDownload);

    // Use centralized helper with folder mode
    await maybeActByPolicy(
      workspaceId,
      folderPath,
      policy,
      'download',
      state,
      services.remote,
      'folder',
      toDownload
    );

    provider.markRecentlyResolvedBatch(
      stringToWsId(workspaceId), 
      toDownload.map(f => f.relPath)
    );
    void vscode.window.showInformationMessage(`LiveSync: downloaded ${toDownload.length} file(s).`);
  });
}