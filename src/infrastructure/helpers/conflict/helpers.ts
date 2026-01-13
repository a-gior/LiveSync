import type { WorkspaceId, RelPath, NodeMeta } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';

/**
 * Check if remote was modified externally (changed since last sync)
 * Compares current remote state with base (last sync point)
 */
export function hasRemoteChangedExternally(
  remote?: NodeMeta,
  base?: NodeMeta
): boolean {
  if (!remote || !base) {return false;}
  return remote.hash !== base.hash;
}

/**
 * Check if local was modified (changed since last sync)
 * Compares current local state with base (last sync point)
 */
export function hasLocalChangedFromBase(
  local?: NodeMeta,
  base?: NodeMeta
): boolean {
  if (!local || !base) {return false;}
  return local.hash !== base.hash;
}

/**
 * Check if there's a type mismatch (file vs folder)
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
 */
export function fileExistsRemote(remoteMeta?: NodeMeta): boolean {
  return !!remoteMeta;
}

/**
 * Check if folder has uncommitted changes
 */
export function folderHasUncommittedChanges(
  workspaceId: WorkspaceId,
  relPath: RelPath,
  state: SyncStateManager
): boolean {
  const entry = state.getDiffEntry(workspaceId, relPath);
  if (!entry || entry.type !== 'folder') {return false;}
  
  return entry.status !== 'unchanged' && 
         entry.status !== 'added' && 
         entry.status !== 'removed';
}

/**
 * Check if local and remote content differ
 */
export function hasContentDifference(
  localMeta?: NodeMeta,
  remoteMeta?: NodeMeta
): boolean {
  if (!localMeta || !remoteMeta) {return false;}
  return localMeta.hash !== remoteMeta.hash;
}

/**
 * Check if both local and remote changed from base (true conflict)
 */
export function hasTrueConflict(
  local?: NodeMeta,
  remote?: NodeMeta,
  base?: NodeMeta
): boolean {
  if (!local || !remote || !base) {return false;}
  
  const localChanged = local.hash !== base.hash;
  const remoteChanged = remote.hash !== base.hash;
  
  // Both changed to different values = conflict
  return localChanged && remoteChanged && local.hash !== remote.hash;
}