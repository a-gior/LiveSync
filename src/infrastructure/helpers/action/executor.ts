/**
 * Action Executors
 * 
 * Pure execution functions that perform file operations.
 * Updates both local and remote snapshots to keep them in sync.
 */

import type { WorkspaceId, RelPath } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { RemotePort } from '@app/ports/RemotePort';
import { absFs } from '@helpers/path';
import { logExpectedError } from '@helpers/logging';
import { syncBothSnapshots, removeFromRemoteSnapshot } from '@helpers/snapshot/update';

/**
 * Execute file upload to remote
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to upload
 * @throws Error if upload fails
 */
export async function executeUpload(
  remote: RemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): Promise<void> {
  const absPath = absFs(workspaceId, relPath);
  
  // Upload file
  await remote.uploadFile(workspaceId, relPath, absPath);
  
  // Sync both snapshots (hash once, update both)
  await syncBothSnapshots(state, workspaceId, relPath, absPath);
}

/**
 * Execute file download from remote
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to download
 * @throws Error if download fails
 */
export async function executeDownload(
  remote: RemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): Promise<void> {
  const absPath = absFs(workspaceId, relPath);
  
  // Download file
  await remote.downloadFile(workspaceId, relPath, absPath);
  
  // Sync both snapshots (hash once, update both)
  await syncBothSnapshots(state, workspaceId, relPath, absPath);
}

/**
 * Execute file deletion from remote
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to delete
 * @throws Error if deletion fails
 */
export async function executeDelete(
  remote: RemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): Promise<void> {
  // Delete from remote
  await remote.deletePath(workspaceId, relPath);
  
  // Update remote snapshot
  removeFromRemoteSnapshot(state, workspaceId, relPath);
}

/**
 * Execute file/folder rename on remote
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param oldPath - Original path
 * @param newPath - New path
 * @param isDir - Whether this is a directory
 * @throws Error if rename fails
 */
export async function executeRename(
  remote: RemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath,
  isDir: boolean
): Promise<void> {
  if (isDir) {
    throw new Error('Folder rename not yet implemented');
  }
  
  const absPath = absFs(workspaceId, newPath);
  
  // Delete old path, upload to new path
  await remote.deletePath(workspaceId, oldPath);
  await remote.uploadFile(workspaceId, newPath, absPath);
  
  // Update remote snapshot (delete old + add new)
  removeFromRemoteSnapshot(state, workspaceId, oldPath);
  await syncBothSnapshots(state, workspaceId, newPath, absPath);
}

/**
 * Execute folder upload (batch operation)
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the files
 * @param files - Array of files to upload
 */
export async function executeUploadFolder(
  remote: RemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  files: Array<{ relPath: RelPath; absLocal: string }>
): Promise<void> {
  const uploaded = await remote.uploadFolder(workspaceId, files);
  
  // Sync both snapshots for all uploaded files
  for (const relPath of uploaded) {
    const absPath = absFs(workspaceId, relPath);
    try {
      await syncBothSnapshots(state, workspaceId, relPath, absPath);
    } catch (err) {
      logExpectedError(`executeUploadFolder:sync:${relPath}`, err);
    }
  }
}

/**
 * Execute folder download (batch operation)
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the files
 * @param files - Array of files to download
 */
export async function executeDownloadFolder(
  remote: RemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  files: Array<{ relPath: RelPath; absLocal: string }>
): Promise<void> {
  const downloaded = await remote.downloadFolder(workspaceId, files);
  
  // Sync both snapshots for all downloaded files
  for (const relPath of downloaded) {
    const absPath = absFs(workspaceId, relPath);
    try {
      await syncBothSnapshots(state, workspaceId, relPath, absPath);
    } catch (err) {
      logExpectedError(`executeDownloadFolder:sync:${relPath}`, err);
    }
  }
}