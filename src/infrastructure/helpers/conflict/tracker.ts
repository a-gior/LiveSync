/**
 * State Utilities - Conflict Tracking
 * 
 * Helper functions for managing conflict ignored state.
 * Wrappers around SyncStateManager methods for cleaner code.
 */

import type { WorkspaceId, RelPath } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { ConflictInfo } from '@helpers/conflict/detector';

// Conflict messages for user-friendly reasons
const CONFLICT_MESSAGES: Record<string, string> = {
  'remote_modified_action': 'Remote file was modified',
  'remote_modified_check': 'Remote file was modified',
  'file_exists_action': 'File already exists on remote',
  'file_exists_check': 'File already exists on remote',
  'uncommitted_changes_action': 'Folder has uncommitted changes',
  'uncommitted_changes_check': 'Folder has uncommitted changes',
  'remote_differs_action': 'Remote file differs from local',
  'remote_differs_check': 'Remote file differs from local',
  'type_mismatch_action': 'Type mismatch (file vs folder)',
  'type_mismatch_check': 'Type mismatch (file vs folder)',
  'content_differs_action': 'File content differs',
  'content_differs_check': 'File content differs',
};

/**
 * Mark a conflict as ignored by the user
 */
export function markConflictIgnored(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath,
  conflict: ConflictInfo
): void {
  const conflictType = mapConflictType(conflict.type);
  const reason = CONFLICT_MESSAGES[conflict.type] || conflict.type;
  
  state.markConflictIgnored(
    workspaceId,
    relPath,
    conflictType,
    reason
  );
}

/**
 * Clear ignored conflict if the file was successfully synced
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
 */
export function isConflictIgnored(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): boolean {
  return state.isConflictIgnored(workspaceId, relPath);
}

/**
 * Map ConflictInfo type string to SyncStateManager conflict type
 */
function mapConflictType(
  conflictType: string
): 'remote-modified' | 'local-modified' {
  // Extract base type from conflict type (remove '_action' or '_check' suffix)
  const baseType = conflictType.replace(/_action$/, '').replace(/_check$/, '');
  
  // Determine if it's remote or local based on keywords
  if (baseType.includes('remote_modified') || 
      baseType.includes('file_exists') || 
      baseType.includes('uncommitted_changes') ||
      baseType.includes('type_mismatch') ||
      baseType.includes('content_differs')) {
    return 'remote-modified';
  }
  
  if (baseType.includes('remote_differs')) {
    return 'local-modified';
  }
  
  // Default to remote-modified
  return 'remote-modified';
}