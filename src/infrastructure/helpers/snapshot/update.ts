import * as vscode from 'vscode';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { WorkspaceId, RelPath } from '@domain/types';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';

/**
 * Update local snapshot for a file/folder
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
 * Sync all three snapshots after successful upload/download
 */
export async function syncAllSnapshots(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath,
  absPath: string
): Promise<void> {
  const hash = await sha256OfFile(absPath);
  const meta = { type: 'file' as const, hash };
  
  // Update all three snapshots with same hash
  state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta });
  state.applyRemote({ workspaceId, type: 'modify', path: relPath, meta });
  state.applyBase({ workspaceId, type: 'modify', path: relPath, meta });
}

/**
 * Remove from local snapshot
 */
export function removeFromLocalSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): void {
  state.applyLocal({ workspaceId, type: 'delete', path: relPath });
}

/**
 * Remove from remote snapshot
 */
export function removeFromRemoteSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): void {
  state.applyRemote({ workspaceId, type: 'delete', path: relPath });
}

/**
 * Remove from base snapshot
 */
export function removeFromBaseSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): void {
  state.applyBase({ workspaceId, type: 'delete', path: relPath });
}

/**
 * Update local snapshot for move
 */
export function moveInLocalSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath
): void {
  state.applyLocal({ workspaceId, type: 'move', path: oldPath, newPath });
}

/**
 * Update remote snapshot for move
 */
export function moveInRemoteSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath
): void {
  state.applyRemote({ workspaceId, type: 'move', path: oldPath, newPath });
}

/**
 * Update base snapshot for move
 */
export function moveInBaseSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  oldPath: RelPath,
  newPath: RelPath
): void {
  state.applyBase({ workspaceId, type: 'move', path: oldPath, newPath });
}