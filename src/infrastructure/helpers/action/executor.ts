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
import { syncAllSnapshots, removeFromRemoteSnapshot, moveInRemoteSnapshot, removeFromBaseSnapshot, moveInBaseSnapshot } from '@helpers/snapshot/update';

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
  await syncAllSnapshots(state, workspaceId, relPath, absPath);
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
  await syncAllSnapshots(state, workspaceId, relPath, absPath);
}

/**
 * Execute file deletion from remote
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to delete
 * @throws Error if delete fails
 */
export async function executeDelete(
  remote: SftpRemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): Promise<void> {
  await remote.deletePath(workspaceId, relPath);
  removeFromRemoteSnapshot(state, workspaceId, relPath);
  removeFromBaseSnapshot(state, workspaceId, relPath);
}

/**
 * Execute file/folder rename/move on remote
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param oldPath - Original path
 * @param newPath - New path
 * @throws Error if rename fails
 */
export async function executeRename(
  remote: SftpRemotePort,
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath
): Promise<void> {
  await remote.move(workspaceId, oldPath, newPath);
  
  // Update remote snapshot
  moveInRemoteSnapshot(state, workspaceId, oldPath, newPath);
  moveInBaseSnapshot(state, workspaceId, oldPath, newPath);
}
