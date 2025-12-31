/**
 * Conflict Resolution
 * 
 * Handles prompting the user and collecting their decision.
 * Manages test mode responses for automated testing.
 */

import * as vscode from 'vscode';
import type { RelPath, WorkspaceId } from '@domain/types';
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
  workspaceId: WorkspaceId,
  relPath: RelPath
): Promise<Resolution> {
  // Test mode: return pre-configured response
  if (isTestMode()) {
    const testResponse = getTestConflictResponse();
    if (testResponse) {
      console.log(`[Test Mode] Auto-resolving conflict with action: ${testResponse}`);
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
    
  if (decision === 'diff') {
    // Show diff
    await vscode.commands.executeCommand('livesync.experimental.node.showDiff', {
      workspaceId,
      relPath
    });

    return { action: 'cancel' };
  }

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
  const message = `${reason}. \n${actionLabel}?`;

  // Build options
  const options: string[] = [];
  
  if (allowDiff) {
    options.push('Show Diff');
  }
  
  options.push('Proceed', 'Ignore');

  // Show modal prompt
  const response = await vscode.window.showWarningMessage(
    message,
    ...options
  );

  // Map response to action
  if (!response || response === 'Cancel') {
    return 'cancel';
  }

  if (response === 'Show Diff') {
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
 * Show info-only notification for check-only policies
 * 
 * @param operation - Type of operation
 * @param relPath - File path
 * @param oldPath - Old path (for rename operations)
 * @param conflict - Optional conflict info (if detected)
 */
export async function showCheckInfo(
  conflict?: ConflictInfo | null
): Promise<void> {
  let message: string;
  
  if (conflict) {
    // Show conflict details
    message = `LiveSync (check): ${conflict.reason}.`;
  } else {
    // Show generic success message
    message = `LiveSync (check): No action taken.`;
  }
  
  // Show info notification (non-blocking)
  vscode.window.showInformationMessage(message);
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