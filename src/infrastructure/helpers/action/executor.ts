/**
 * Action Executors
 * 
 * Pure execution functions that perform file operations.
 * Updates both local and remote snapshots to keep them in sync.
 */

import type { WorkspaceId, RelPath } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { RemotePort as SftpRemotePort } from '@app/ports/RemotePort';
import { absFs } from '@helpers/path';
import { logExpectedError } from '@helpers/logging';
import { syncBothSnapshots, removeFromRemoteSnapshot, renameInRemoteSnapshot } from '@helpers/snapshot/update';

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
  remote: SftpRemotePort,
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
  remote: SftpRemotePort,
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
  remote: SftpRemotePort,
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
  remote: SftpRemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath
): Promise<void> {
  // Check if target exists on remote (conflict case where user chose "Proceed")
  const newRemoteMeta = state.getDiffEntry(workspaceId, newPath);
  
  if (newRemoteMeta && newRemoteMeta.status !== 'removed') {
    // Target exists - delete it first (user already chose "Proceed" to overwrite)
    try {
      await remote.deletePath(workspaceId, newPath);
    } catch (err) {
      logExpectedError(`executeRename:deleteTarget:${newPath}`, err);
      // Continue anyway - target might not exist on remote
    }
  }
  
  // Now safe to rename (works for both files AND folders)
  await remote.rename(workspaceId, oldPath, newPath);
  
  // Update remote snapshot
  renameInRemoteSnapshot(state, workspaceId, oldPath, newPath);
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
  remote: SftpRemotePort,
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
  remote: SftpRemotePort,
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