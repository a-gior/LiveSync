/**
 * State Utilities - Conflict Tracking
 * 
 * Helper functions for managing conflict ignored state.
 * Wrappers around SyncStateManager methods for cleaner code.
 */

import type { WorkspaceId, RelPath } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { ConflictInfo } from '@helpers/conflict/detector';

/**
 * Mark a conflict as ignored by the user
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path of the file
 * @param conflict - Conflict information
 */
export function markConflictIgnored(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath,
  conflict: ConflictInfo
): void {
  const conflictType = mapConflictType(conflict.type);
  
  state.markConflictIgnored(
    workspaceId,
    relPath,
    conflictType,
    conflict.reason
  );
}

/**
 * Clear ignored conflict if the file was successfully synced
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path of the file
 */
export function clearIgnoredConflictIfResolved(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): void {
  if (state.isConflictIgnored(workspaceId, relPath)) {
    state.clearIgnoredConflict(workspaceId, relPath);
  }
}

/**
 * Check if a conflict is currently ignored
 * 
 * @param state - State manager
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path of the file
 * @returns true if conflict is marked as ignored
 */
export function isConflictIgnored(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): boolean {
  return state.isConflictIgnored(workspaceId, relPath);
}

/**
 * Map ConflictInfo type to SyncStateManager conflict type
 */
function mapConflictType(
  conflictType: ConflictInfo['type']
): 'remote-modified' | 'local-modified' {
  switch (conflictType) {
    case 'upload-conflict':
    case 'exists-conflict':
    case 'delete-conflict':
      return 'remote-modified';
    case 'download-conflict':
      return 'local-modified';
    default:
      return 'remote-modified';
  }
}