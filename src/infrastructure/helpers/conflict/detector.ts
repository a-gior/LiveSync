/**
 * Conflict Detection
 * 
 * Pure functions to detect conflicts based on current state.
 * No side effects - just reads state and returns conflict info.
 */

import type { WorkspaceId, RelPath, NodeMeta } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import { basenameRel } from '../path';

export type ConflictType = 
  | 'upload-conflict'      // Remote modified, trying to upload
  | 'download-conflict'    // Local modified, trying to download
  | 'exists-conflict'      // File exists remotely, trying to create
  | 'rename-conflict'     // File exists remotely, trying to rename or move
  | 'delete-conflict';     // Remote modified, trying to delete

export interface ConflictInfo {
  type: ConflictType;
  reason: string;
  allowDiff: boolean;
  suggestedAction: 'upload' | 'download' | 'delete' | 'skip';
}

/**
 * Detect conflict for a specific operation
 * 
 * IMPORTANT: Assumes snapshots are already fresh!
 * Call ensureFreshRemoteSnapshot() or ensureFreshLocalSnapshot() before this.
 * 
 * @param operation - Type of file operation
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to check
 * @param state - State manager with fresh snapshots
 * @returns ConflictInfo if conflict detected, null otherwise
 */
export function detectConflict(
  operation: 'save' | 'create' | 'delete' | 'rename' | 'open',
  workspaceId: WorkspaceId,
  relPath: RelPath,
  state: SyncStateManager,
  oldLocalMeta?: NodeMeta
): ConflictInfo | null {
  const localMeta = state.getLocalMeta(workspaceId, relPath) || oldLocalMeta;
  const remoteMeta = state.getRemoteMeta(workspaceId, relPath);
  const fileName = basenameRel(relPath);

  switch (operation) {
    case 'save': {
      // Uploading local changes - check if remote was modified
      if (!remoteMeta || remoteMeta.type !== 'file') {
        return null; // No remote file, no conflict
      }
      
      if (!localMeta || localMeta.type !== 'file') {
        return null; // No local file, no conflict
      }
      
      const remoteModified = remoteMeta.hash !== localMeta.hash;
      
      if (remoteModified) {
        return {
          type: 'upload-conflict',
          reason: `Remote file ${fileName} was modified`,
          allowDiff: true,
          suggestedAction: 'upload'
        };
      }
      
      return null;
    }

    case 'create':
    case 'rename': {
      // For folders: check if status is NOT 'unchanged' or 'added'
      if (localMeta && localMeta.type === 'folder') {
        const folderEntry = state.getDiffEntry(workspaceId, relPath);
        if (folderEntry && 
            folderEntry.status !== 'unchanged' && 
            folderEntry.status !== 'added') {
          return {
            type: 'rename-conflict',
            reason: `Folder ${fileName} has uncommitted changes`,
            allowDiff: false,
            suggestedAction: 'skip'
          };
        }
      }
      
      // Creating/moving file - check if it already exists remotely
      if (remoteMeta) {
        return {
          type: 'exists-conflict',
          reason: operation === 'create' 
            ? `File ${fileName} already exists on remote server`
            : 'Target path already exists on remote server',
          allowDiff: remoteMeta.type === 'file',
          suggestedAction: 'download' // Suggest downloading existing remote file
        };
      }
      
      return null;
    }

    case 'delete': {
      // Deleting file - check if remote was modified or deleted
      if (!remoteMeta) {
        return null;
      }

      if (remoteMeta.type !== 'file') {
        return null; // Not a file, no conflict check
      }

      // Check if remote was modified since last sync
      if (localMeta && localMeta.type === 'file') {
        const remoteModified = remoteMeta.hash !== localMeta.hash;
        
        if (remoteModified) {
          return {
            type: 'delete-conflict',
            reason: `Remote ${fileName} file was modified before deletion`,
            allowDiff: true,
            suggestedAction: 'skip' // Suggest keeping modified file
          };
        }
      }
      
      return null;
    }

    case 'open': {
      // Downloading file - check if local was modified
      if (!localMeta || localMeta.type !== 'file') {
        return null; // No local file, no conflict
      }
      
      if (!remoteMeta || remoteMeta.type !== 'file') {
        return null; // No remote file, no conflict
      }
      
      const localModified = localMeta.hash !== remoteMeta.hash;
      
      if (localModified) {
        return {
          type: 'download-conflict',
          reason: `Local file ${fileName} was modified`,
          allowDiff: true,
          suggestedAction: 'download'
        };
      }
      
      return null;
    }

    default:
      return null;
  }
}

/**
 * Check if a file is currently marked as having an ignored conflict
 */
export function hasIgnoredConflict(
  state: SyncStateManager,
  workspaceId: WorkspaceId,
  relPath: RelPath
): boolean {
  return state.isConflictIgnored(workspaceId, relPath);
}