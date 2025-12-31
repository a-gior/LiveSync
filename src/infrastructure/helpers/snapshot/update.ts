/**
 * Snapshot Update Helpers
 * 
 * Convenience functions to update snapshots after file operations.
 * These ensure local and remote snapshots stay synchronized.
 */

import * as vscode from 'vscode';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { WorkspaceId, RelPath } from '@domain/types';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';

/**
 * Update local snapshot for a file/folder
 * Used by FileEventBridge for internal VS Code events.
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to update
 * @param uri - VS Code URI of the file
 */
export async function updateLocalSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath,
  uri: vscode.Uri
): Promise<void> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const isDir = (stat.type & vscode.FileType.Directory) !== 0;
    
    if (isDir) {
      state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'folder', hash: '' }
      });
    } else {
      const hash = await sha256OfFile(uri.fsPath);
      state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash }
      });
    }
  } catch (err) {
    logExpectedError(`updateLocalSnapshot:${relPath}`, err);
    throw err;
  }
}

/**
 * Sync both local and remote snapshots after upload/download
 * 
 * This is the core helper used by all executor functions.
 * Hashes the file once and updates both snapshots to keep them in sync.
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path of the file
 * @param absPath - Absolute path to the file
 * @throws Error if hashing fails
 */
export async function syncBothSnapshots(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath,
  absPath: string
): Promise<void> {
  const hash = await sha256OfFile(absPath);
  const meta = { type: 'file' as const, hash };
  
  // Update both snapshots with same hash
  state.applyLocal({
    workspaceId,
    type: 'modify',
    path: relPath,
    meta
  });
  
  state.applyRemote({
    workspaceId,
    type: 'modify',
    path: relPath,
    meta
  });
}

/**
 * Remove file/folder from local snapshot
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to remove
 */
export function removeFromLocalSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): void {
  state.applyLocal({
    workspaceId,
    type: 'delete',
    path: relPath
  });
}

/**
 * Remove file/folder from remote snapshot
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to remove
 */
export function removeFromRemoteSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): void {
  state.applyRemote({
    workspaceId,
    type: 'delete',
    path: relPath
  });
}

/**
 * Update local snapshot for a rename operation
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param oldPath - Original path
 * @param newPath - New path
 */
export function renameInLocalSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath
): void {
  state.applyLocal({
    workspaceId,
    type: 'rename',
    path: oldPath,
    newPath: newPath
  });
}

/**
 * Update remote snapshot for a rename operation
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param oldPath - Original path
 * @param newPath - New path
 */
export function renameInRemoteSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath
): void {
  state.applyRemote({
    workspaceId,
    type: 'rename',
    path: oldPath,
    newPath: newPath
  });
}