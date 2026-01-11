/**
 * Conflict Detection Helper Functions
 * 
 * Small, focused functions for detecting specific conflict conditions.
 * These are used by the main detectConflict() function to build conflict types.
 */

import type { WorkspaceId, RelPath, NodeMeta } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';

/**
 * Check if remote was modified externally (someone else changed it)
 * 
 * Compares our last known remote state (snapshot) with fresh remote state.
 * If different, someone else modified the file.
 * 
 * @param oldRemote - Remote meta from snapshot (our last intentional change)
 * @param actualRemote - Fresh remote meta (just fetched)
 * @returns true if remote was modified by someone else
 */
export function hasRemoteChangedExternally(
  oldRemote?: NodeMeta,
  actualRemote?: NodeMeta
): boolean {
  if (!oldRemote || !actualRemote) {return false;}
  return oldRemote.hash !== actualRemote.hash;
}

/**
 * Check if there's a type mismatch (file vs folder)
 * 
 * @param localMeta - Local file/folder metadata
 * @param remoteMeta - Remote file/folder metadata
 * @returns true if types don't match
 */
export function hasTypeMismatch(
  localMeta?: NodeMeta,
  remoteMeta?: NodeMeta
): boolean {
  if (!localMeta || !remoteMeta) {return false;}
  return localMeta.type !== remoteMeta.type;
}

/**
 * Check if file exists remotely
 * 
 * @param remoteMeta - Remote metadata
 * @returns true if file/folder exists on remote
 */
export function fileExistsRemote(remoteMeta?: NodeMeta): boolean {
  return !!remoteMeta;
}

/**
 * Check if folder has uncommitted changes
 * 
 * A folder has uncommitted changes if its status is anything other than:
 * - 'unchanged' (synced)
 * - 'added' (only exists locally, but that's ok for new folders)
 * - 'removed' (only exists remotely, but we're deleting locally)
 * 
 * @param workspaceId - Workspace containing the folder
 * @param relPath - Relative path to the folder
 * @param state - State manager
 * @returns true if folder has uncommitted changes
 */
export function folderHasUncommittedChanges(
  workspaceId: WorkspaceId,
  relPath: RelPath,
  state: SyncStateManager
): boolean {
  const entry = state.getDiffEntry(workspaceId, relPath);
  if (!entry || entry.type !== 'folder') {return false;}
  
  // Allow unchanged, added, and removed
  return entry.status !== 'unchanged' && 
         entry.status !== 'added' && 
         entry.status !== 'removed';
}

/**
 * Check if local and remote content differ
 * 
 * @param localMeta - Local metadata
 * @param remoteMeta - Remote metadata
 * @returns true if content hashes differ
 */
export function hasContentDifference(
  localMeta?: NodeMeta,
  remoteMeta?: NodeMeta
): boolean {
  if (!localMeta || !remoteMeta) {return false;}
  return localMeta.hash !== remoteMeta.hash;
}