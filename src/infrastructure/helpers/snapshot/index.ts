/**
 * Snapshot Refresh Helpers
 * 
 * These functions ensure local and remote snapshots are fresh
 * by fetching actual current state and updating the state manager.
 * 
 * Call these BEFORE checkShouldPrompt() to ensure accurate conflict detection.
 */

import * as vscode from 'vscode';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { RemotePort } from '@app/ports/RemotePort';
import type { WorkspaceId, RelPath } from '@domain/types';
import { absFs } from '@helpers/path';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { logExpectedError } from '@helpers/logging';

/**
 * Ensure remote snapshot reflects actual current remote state
 * 
 * Fetches the current remote index and updates the snapshot with actual metadata.
 * This should be called before any operation that checks remote state (uploads).
 * 
 * @param state - State manager
 * @param remote - Remote port
 * @param workspaceId - Workspace to refresh
 * @param relPath - Optional specific file/folder to update (still fetches entire workspace)
 * 
 * Note: Always fetches entire workspace via remote.list() for efficiency.
 * The relPath parameter just controls which file(s) get explicitly updated in snapshot.
 * 
 * Usage:
 * ```typescript
 * // Before checking for upload conflicts:
 * await ensureFreshRemoteSnapshot(this.state, this.remote, workspaceId, relPath);
 * const { shouldPrompt } = await checkShouldPrompt('save', ...);
 * ```
 */
export async function ensureFreshRemoteSnapshot(
  state: SyncStateManager,
  remote: RemotePort,
  workspaceId: WorkspaceId,
  relPath?: RelPath
): Promise<void> {
  try {
    const remoteIndex = await remote.list(workspaceId);
    
    if (relPath) {
      // Update specific file/folder
      const meta = remoteIndex.get(relPath);
      if (meta) {
        state.applyRemote({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta
        });
      }
      // Note: If file doesn't exist remotely, we DON'T delete from snapshot
      // because it might be about to be uploaded (snapshot represents expected state)
    } else {
      // Update entire workspace
      state.setRemoteIndex(workspaceId, remoteIndex);
    }
  } catch (err) {
    logExpectedError(`ensureFreshRemoteSnapshot:${relPath || 'workspace'}`, err);
    // Don't throw - let operation continue with stale snapshot
  }
}

/**
 * Ensure local snapshot reflects actual current local state
 * 
 * Re-hashes the local file/folder and updates the snapshot with actual metadata.
 * This should be called before any operation that checks local state (downloads).
 * 
 * @param state - State manager
 * @param remote - Remote port (not used, kept for consistency)
 * @param workspaceId - Workspace containing the file
 * @param relPath - Specific file/folder to refresh (REQUIRED - don't refresh entire workspace)
 * 
 * Note: Unlike remote refresh, this REQUIRES relPath because hashing entire
 * workspace is too expensive. Only call when you need to verify local state.
 * 
 * Usage:
 * ```typescript
 * // Before checking for download conflicts:
 * await ensureFreshLocalSnapshot(this.state, this.remote, workspaceId, relPath);
 * const { shouldPrompt } = await checkShouldPrompt('download', ...);
 * ```
 */
export async function ensureFreshLocalSnapshot(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): Promise<void> {
  const absPath = absFs(workspaceId, relPath);
  
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
    const isDir = (stat.type & vscode.FileType.Directory) !== 0;
    
    if (isDir) {
      state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'folder', hash: '' }
      });
    } else {
      const hash = await sha256OfFile(absPath);
      state.applyLocal({
        workspaceId,
        type: 'modify',
        path: relPath,
        meta: { type: 'file', hash }
      });
    }
  } catch (err) {
    // File doesn't exist locally - remove from snapshot
    try {
      state.applyLocal({
        workspaceId,
        type: 'delete',
        path: relPath
      });
    } catch (deleteErr) {
      logExpectedError(`ensureFreshLocalSnapshot:delete:${relPath}`, deleteErr);
    }
  }
}

/**
 * Refresh both local and remote snapshots
 * 
 * Convenience function for operations that need both snapshots fresh.
 * 
 * @param state - State manager
 * @param remote - Remote port
 * @param workspaceId - Workspace to refresh
 * @param relPath - Specific file to refresh
 * 
 * Usage:
 * ```typescript
 * // Before showing diff or checking bidirectional sync:
 * await ensureFreshSnapshots(this.state, this.remote, workspaceId, relPath);
 * ```
 */
export async function ensureFreshSnapshots(
  state: SyncStateManager,
  remote: RemotePort,
  workspaceId: WorkspaceId,
  relPath: RelPath
): Promise<void> {
  await Promise.all([
    ensureFreshRemoteSnapshot(state, remote, workspaceId, relPath),
    ensureFreshLocalSnapshot(state, workspaceId, relPath)
  ]);
}