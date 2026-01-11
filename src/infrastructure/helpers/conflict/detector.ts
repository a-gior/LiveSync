/**
 * Conflict Detection - Keyword-Based System
 * 
 * Pure functions to detect conflicts based on current state.
 * Uses keywords to build conflict types dynamically.
 */

import type { WorkspaceId, RelPath, NodeMeta } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import {
  hasRemoteChangedExternally,
  hasTypeMismatch,
  fileExistsRemote,
  folderHasUncommittedChanges,
  hasContentDifference
} from './helpers';

/**
 * Conflict detection parameters
 */
export interface ConflictDetectionParams {
  operation: 'save' | 'create' | 'delete' | 'move' | 'open';
  workspaceId: WorkspaceId;
  relPath: RelPath;
  actualMetas: { 
    local?: NodeMeta;   // Current filesystem state
    remote?: NodeMeta;  // Fresh remote (just fetched, NOT saved to snapshot)
  };
  oldMetas: { 
    local?: NodeMeta;   // From snapshot (before event)
    remote?: NodeMeta;  // From snapshot (our last intentional change)
  };
  state: SyncStateManager;
  isCheckOnly: boolean;  // From policy.check
}

/**
 * Conflict information returned to caller
 */
export interface ConflictInfo {
  type: string;           // e.g., 'remote_modified_action', 'file_exists_check'
  allowDiff: boolean;     // Whether "Show Diff" button should appear
  suggestedAction: 'upload' | 'download' | 'delete' | 'skip';
}

/**
 * Detect conflict for a specific operation
 * 
 * Uses keyword-based system to build conflict types dynamically.
 * Keywords describe what's wrong, mode describes the policy.
 * 
 * @param params - Detection parameters
 * @returns ConflictInfo if conflict detected, null otherwise
 */
export function detectConflict(params: ConflictDetectionParams): ConflictInfo | null {
  const { operation, workspaceId, relPath, actualMetas, oldMetas, state, isCheckOnly } = params;
  const keywords: string[] = [];
  
  // ══════════════════════════════════════════════════════════
  // GLOBAL CHECKS (apply to all operations)
  // ══════════════════════════════════════════════════════════
  
  if (hasTypeMismatch(actualMetas.local, actualMetas.remote)) {
    keywords.push('type_mismatch');
  }
  
  // ══════════════════════════════════════════════════════════
  // OPERATION-SPECIFIC CHECKS
  // ══════════════════════════════════════════════════════════
  
  switch (operation) {
    case 'save':
      // Check if content differs (always check this!)
      if (hasContentDifference(actualMetas.local, actualMetas.remote)) {
        // Now determine why for better messaging:
        
        if (hasRemoteChangedExternally(oldMetas.remote, actualMetas.remote)) {
          // Remote changed since we last synced
          keywords.push('remote_modified');
        } 
        else if (!oldMetas.remote && fileExistsRemote(actualMetas.remote)) {
          // File exists but we never synced it
          keywords.push('file_exists');
        } 
        else {
          // They just differ (refresh updated snapshot, manual edit, etc.)
          keywords.push('content_differs');
        }
      }
      break;
      
    case 'create':
      // Check if file already exists remotely
      if (fileExistsRemote(actualMetas.remote)) {
        keywords.push('file_exists');
      }
      break;
      
    case 'move':
      // For folders: check uncommitted changes
      if (actualMetas.local?.type === 'folder') {
        if (folderHasUncommittedChanges(workspaceId, relPath, state)) {
          keywords.push('uncommitted_changes');
        }
      }
      // For files: check if target exists
      else if (fileExistsRemote(actualMetas.remote)) {
        keywords.push('file_exists');
      }
      break;
      
    case 'delete':
      // For folders: check uncommitted changes
      if (oldMetas.local?.type === 'folder') {
        if (folderHasUncommittedChanges(workspaceId, relPath, state)) {
          keywords.push('uncommitted_changes');
        }
      }
      // For files: check if remote was modified
      else if (hasRemoteChangedExternally(oldMetas.remote, actualMetas.remote)) {
        keywords.push('remote_modified');
      }
      break;
      
    case 'open':
      // Check if remote differs from local
      if (hasContentDifference(actualMetas.local, actualMetas.remote)) {
        keywords.push('remote_differs');
      }
      break;
  }
  
  // No conflict detected
  if (keywords.length === 0) {return null;}
  
  // ══════════════════════════════════════════════════════════
  // BUILD CONFLICT TYPE
  // ══════════════════════════════════════════════════════════
  
  const mode = isCheckOnly ? 'check' : 'action';
  const type = `${keywords.join('_')}_${mode}`;
  
  return {
    type,
    allowDiff: determineAllowDiff(keywords),
    suggestedAction: determineSuggestedAction(operation, keywords)
  };
}

/**
 * Determine if diff viewer should be available
 * 
 * @param keywords - Conflict keywords
 * @returns true if diff should be allowed
 */
function determineAllowDiff(keywords: string[]): boolean {
  // Type mismatch → no diff possible (file vs folder)
  if (keywords.includes('type_mismatch')) {return false;}
  
  // Uncommitted changes → no meaningful diff (folder-level)
  if (keywords.includes('uncommitted_changes')) {return false;}
  
  // All other cases → allow diff
  return true;
}

/**
 * Determine suggested action based on operation and conflict keywords
 * 
 * @param operation - Type of operation
 * @param keywords - Conflict keywords
 * @returns Suggested action to perform
 */
function determineSuggestedAction(
  operation: 'save' | 'create' | 'delete' | 'move' | 'open',
  keywords: string[]
): 'upload' | 'download' | 'delete' | 'skip' {
  // Type mismatch or uncommitted changes → skip (can't proceed safely)
  if (keywords.includes('type_mismatch') || keywords.includes('uncommitted_changes')) {
    return 'skip';
  }
  
  switch (operation) {
    case 'save':
      return 'upload';  // Remote modified, but we want to upload anyway
      
    case 'create':
      return 'download';  // File exists, suggest downloading it
      
    case 'move':
      return 'upload';  // Target exists, suggest overwriting
      
    case 'delete':
      return 'delete';  // Remote modified, but we want to delete anyway
      
    case 'open':
      return 'download';  // Remote differs, suggest downloading
      
    default:
      return 'skip';
  }
}