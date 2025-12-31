/**
 * Conflict Resolution
 * 
 * Handles prompting the user and collecting their decision.
 * Manages test mode responses for automated testing.
 */

import * as vscode from 'vscode';
import type { RelPath } from '@domain/types';
import type { ConflictInfo } from './detector';
import { getTestConflictResponse, isTestMode } from '@helpers/test';

export type Resolution = 
  | { action: 'proceed' }
  | { action: 'cancel' }
  | { action: 'ignore' }
  | { action: 'diff' };

/**
 * Resolve a detected conflict by prompting the user
 * 
 * @param conflict - The detected conflict information
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path of the conflicting file
 * @param state - State manager (used for test mode only)
 * @returns User's decision on how to proceed
 */
export async function resolveConflict(
  conflict: ConflictInfo,
): Promise<Resolution> {
  // Test mode: return pre-configured response
  if (isTestMode()) {
    const testResponse = getTestConflictResponse();
    if (testResponse) {
      return { action: testResponse };
    }
  }

  // Determine action mode based on conflict type
  const mode = conflict.suggestedAction === 'skip' 
    ? 'delete'
    : conflict.suggestedAction;

  // Show prompt to user
  const decision = await promptUser(
    mode,
    conflict.allowDiff,
    conflict.reason
  );

  return { action: decision };
}

/**
 * Show conflict prompt to user
 * 
 * @param mode - Type of action being attempted
 * @param allowDiff - Whether to show "Show Diff" option
 * @param relPath - File path for display
 * @param reason - Conflict reason/message
 * @returns User's choice: 'proceed' | 'diff' | 'cancel' | 'ignore'
 */
async function promptUser(
  mode: 'upload' | 'download' | 'delete' | 'move',
  allowDiff: boolean,
  reason: string
): Promise<'proceed' | 'diff' | 'cancel' | 'ignore'> {
  const actionLabel = getActionLabel(mode);
  const message = `${reason}. ${actionLabel}?`;

  // Build options
  const options: string[] = [];
  
  if (allowDiff) {
    options.push('Show Diff');
  }
  
  options.push('Proceed', 'Ignore', 'Cancel');

  // Show modal prompt
  const response = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    ...options
  );

  // Map response to action
  if (!response || response === 'Cancel') {
    return 'cancel';
  }

  if (response === 'Show Diff') {
    // TODO: Show diff, then re-prompt
    // For now, just return diff action
    return 'diff';
  }

  if (response === 'Ignore') {
    return 'ignore';
  }

  if (response === 'Proceed') {
    return 'proceed';
  }

  return 'cancel'; // Default fallback
}

/**
 * Get human-readable action label
 */
function getActionLabel(mode: 'upload' | 'download' | 'delete' | 'move'): string {
  switch (mode) {
    case 'upload':
      return 'Upload anyway';
    case 'download':
      return 'Download anyway';
    case 'delete':
      return 'Delete anyway';
    case 'move':
      return 'Move anyway';
    default:
      return 'Proceed anyway';
  }
}

/**
 * Show info-only notification for check-only policies
 * (no action will be taken, just informing user of the check result)
 */
export async function showCheckInfo(
  operation: 'save' | 'create' | 'delete' | 'rename' | 'open',
  relPath: RelPath,
  oldPath?: RelPath
): Promise<void> {
  const verb = operation === 'save' ? 'Saved' :
    operation === 'create' ? 'Created' :
    operation === 'delete' ? 'Deleted' :
    operation === 'open' ? 'Opened' :
    'Renamed';

  const display = oldPath ? `${oldPath} → ${relPath}` : relPath;

  const message = `LiveSync (check): ${verb} "${display}". No sync action taken (policy = check).`;
  
  // Show info notification (non-blocking)
  vscode.window.showInformationMessage(message);
}