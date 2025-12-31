/**
 * Action Executors
 * 
 * Pure execution functions that perform file operations.
 * No conflict checking, no prompting - just execute the action.
 * 
 * These update both the remote state AND the local/remote snapshots.
 */

import type { WorkspaceId, RelPath } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { RemotePort } from '@app/ports/RemotePort';
import { absFs } from '@helpers/path';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';

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
  
  // Update remote snapshot
  const hash = await sha256OfFile(absPath);
  state.applyRemote({
    workspaceId,
    type: 'modify',
    path: relPath,
    meta: { type: 'file', hash }
  });
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
  
  // Update local snapshot
  const hash = await sha256OfFile(absPath);
  state.applyLocal({
    workspaceId,
    type: 'modify',
    path: relPath,
    meta: { type: 'file', hash }
  });
}

/**
 * Execute file deletion on remote
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
  state.applyRemote({
    workspaceId,
    type: 'delete',
    path: relPath
  });
}

/**
 * Execute file/folder rename on remote
 * 
 * @param remote - Remote port
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param oldPath - Original path
 * @param newPath - New path
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
  // Delete old path on remote
  await remote.deletePath(workspaceId, oldPath);
  
  // Upload to new path
  if (isDir) {
    // For folders, would need to upload entire subtree
    // This is complex - log error for now
    logExpectedError(`executeRename:folder:${newPath}`, 
      new Error('Folder rename not fully implemented'));
  } else {
    const absPath = absFs(workspaceId, newPath);
    await remote.uploadFile(workspaceId, newPath, absPath);
    
    const hash = await sha256OfFile(absPath);
    state.applyRemote({
      workspaceId,
      type: 'modify',
      path: newPath,
      meta: { type: 'file', hash }
    });
  }
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
  
  // Update remote snapshot for all uploaded files
  for (const relPath of uploaded) {
    const absPath = absFs(workspaceId, relPath);
    try {
      const hash = await sha256OfFile(absPath);
      state.applyRemote({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash }
      });
    } catch (err) {
      logExpectedError(`executeUploadFolder:hash:${relPath}`, err);
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
  
  // Update local snapshot for all downloaded files
  for (const relPath of downloaded) {
    const absPath = absFs(workspaceId, relPath);
    try {
      const hash = await sha256OfFile(absPath);
      state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash }
      });
    } catch (err) {
      logExpectedError(`executeDownloadFolder:hash:${relPath}`, err);
    }
  }
}