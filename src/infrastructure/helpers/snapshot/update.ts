/**
 * Additional Snapshot Helpers
 * 
 * Convenience functions to update snapshots.
 * Add these to the existing snapshot/index.ts file.
 */

import * as vscode from 'vscode';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { WorkspaceId, RelPath } from '@domain/types';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';

/**
 * Update local snapshot for a file/folder
 * 
 * Convenience function that combines stat + applyLocal.
 * Determines if file/folder and hashes if needed.
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