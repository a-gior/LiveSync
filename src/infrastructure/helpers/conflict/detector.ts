import type { WorkspaceId, RelPath, NodeMeta } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import {
  hasRemoteChangedExternally,
  hasTypeMismatch,
  fileExistsRemote,
  folderHasUncommittedChanges,
  hasContentDifference,
} from './helpers';
import { LOG_FLAGS, logInfoMessage } from '../logging';

export type OperationType = 'save' | 'create' | 'delete' | 'move' | 'open' | 'upload' | 'download';
export type Action = 'upload' | 'download' | 'delete' | 'move' | 'skip';

/**
 * Conflict detection parameters
 */
export interface ConflictDetectionParams {
  operation: OperationType;
  workspaceId: WorkspaceId;
  relPath: RelPath;
  actualMetas: { 
    local?: NodeMeta;
    remote?: NodeMeta;
  };
  baseMeta?: NodeMeta;  // CHANGED: single baseMeta instead of oldMetas
  state: SyncStateManager;
  isCheckOnly: boolean;
}

export interface ConflictInfo {
  type: string;
  allowDiff: boolean;
  suggestedAction: Action;
}

export function detectConflict(params: ConflictDetectionParams): ConflictInfo | null {
  const { operation, workspaceId, relPath, actualMetas, baseMeta, state, isCheckOnly } = params;
  const keywords: string[] = [];
  
  // Type mismatch check
  if (hasTypeMismatch(actualMetas.local, actualMetas.remote)) {
    keywords.push('type_mismatch');
  }
  
  // Suggested action
  let suggestedAction: ConflictInfo['suggestedAction'] = 'skip';
  if (operation === 'save' || operation === 'create' || operation === 'upload') {
    suggestedAction = 'upload';
  } else if (operation === 'move') {
    suggestedAction = 'move';
  } else if (operation === 'open' || operation === 'download') {
    suggestedAction = 'download';
  } else if (operation === 'delete') {
    suggestedAction = 'delete';
  }
  
  // Operation-specific checks
  switch (operation) {
    case 'save':
      if (hasRemoteChangedExternally(actualMetas.remote, baseMeta)) {
        // Remote different from base
        keywords.push('remote_modified');
      }
      else if (!baseMeta && fileExistsRemote(actualMetas.remote)) {
        // File exists but never synced
        keywords.push('file_exists');
      }
      break;
      
    case 'create':
      if (fileExistsRemote(actualMetas.remote)) {
        keywords.push('file_exists');
        suggestedAction = 'download'; // Override action to download on create conflict
      }
      break;
      
    case 'move':
      if (actualMetas.local?.type === 'folder') {
        if (folderHasUncommittedChanges(workspaceId, relPath, state)) {
          keywords.push('uncommitted_changes');
        }
      }
      else if (fileExistsRemote(actualMetas.remote)) {
        keywords.push('file_exists');
      }
      break;
      
    case 'delete':
      if (baseMeta?.type === 'folder') {
        if (folderHasUncommittedChanges(workspaceId, relPath, state)) {
          keywords.push('uncommitted_changes');
        }
      }
      else if (hasRemoteChangedExternally(actualMetas.remote, baseMeta)) {
        keywords.push('remote_modified');
      }
      break;
      
    case 'open':
      if (hasContentDifference(actualMetas.local, actualMetas.remote)) {
        keywords.push('remote_differs');
      } else {
        // Avoid downloading on each open
        return {type:"skip", allowDiff:false, suggestedAction:'skip'};
      }
      break;
  }
  
  logInfoMessage(`Conflict detection keywords: ${keywords}`, LOG_FLAGS.CONSOLE_ONLY);
  if (keywords.length === 0) {return null;}
  
  // Build conflict type
  const mode = isCheckOnly ? 'check' : 'action';
  const type = keywords.join('_') + '_' + mode;
  
  // Determine if diff is allowed
  const allowDiff = keywords.some(k => 
    ['remote_modified', 'content_differs', 'remote_differs', 'file_exists'].includes(k)
  );
  
  return { type, allowDiff, suggestedAction };
}