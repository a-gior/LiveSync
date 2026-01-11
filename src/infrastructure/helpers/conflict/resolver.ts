/**
 * Conflict Resolution - User Prompts
 * 
 * Handles prompting the user and collecting their decision.
 * Uses conflict type to determine appropriate message.
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
 * Mapping of conflict types to user-facing messages
 */
const CONFLICT_MESSAGES: Record<string, string> = {
  // Save conflicts
  'remote_modified_action': 'Remote file was modified',
  'remote_modified_check': 'Remote file was modified',
  
  // Create conflicts
  'file_exists_action': 'File already exists on remote',
  'file_exists_check': 'File already exists on remote',
  
  // Move conflicts (file_exists is reused, but message is context-dependent)
  'uncommitted_changes_action': 'Folder has uncommitted changes',
  'uncommitted_changes_check': 'Folder has uncommitted changes',
  
  // Delete conflicts (remote_modified is reused)
  
  // Open conflicts
  'remote_differs_action': 'Remote file differs from local',
  'remote_differs_check': 'Remote file differs from local',
  
  // Global conflicts
  'type_mismatch_action': 'Type mismatch (file vs folder)',
  'type_mismatch_check': 'Type mismatch (file vs folder)',
};

/**
 * Mapping of suggested actions to user-facing labels
 */
const ACTION_LABELS: Record<string, string> = {
  'upload': 'Upload anyway',
  'download': 'Download anyway',
  'delete': 'Delete anyway',
  'skip': 'Skip',
};

/**
 * Resolve a detected conflict by prompting the user
 * 
 * @param conflict - The detected conflict information
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path of the conflicting file
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

  // Prompt user with appropriate message
  const decision = await promptUserForConflict(conflict);
    
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
 * Prompt user to resolve conflict
 * 
 * @param conflict - Detected conflict
 * @returns User's decision
 */
async function promptUserForConflict(
  conflict: ConflictInfo
): Promise<'proceed' | 'cancel' | 'ignore' | 'diff'> {
  // Get message for this conflict type
  const message = CONFLICT_MESSAGES[conflict.type] || 'Conflict detected';
  
  // Check-only conflicts → just show info, no action
  if (conflict.type.endsWith('_check')) {
    await vscode.window.showInformationMessage(`LiveSync (check): ${message}.`);
    return 'cancel';  // Don't proceed with any action
  }
  
  // Action conflicts → prompt user with options
  const actionLabel = ACTION_LABELS[conflict.suggestedAction] || 'Proceed anyway';
  const fullMessage = `${message}.\n${actionLabel}?`;
  
  const options: string[] = [];
  
  if (conflict.allowDiff) {
    options.push('Show Diff');
  }
  
  options.push('Proceed', 'Ignore');
  
  const response = await vscode.window.showWarningMessage(fullMessage, ...options);
  
  if (!response || response === 'Cancel') {return 'cancel';}
  if (response === 'Show Diff') {return 'diff';}
  if (response === 'Ignore') {return 'ignore';}
  if (response === 'Proceed') {return 'proceed';}
  
  return 'cancel';
}

/**
 * Show info-only notification for check-only policies
 * (Alternative to resolveConflict when policy is check-only)
 * 
 * @param conflict - Optional conflict info (if detected)
 */
export async function showCheckInfo(
  conflict?: ConflictInfo | null
): Promise<void> {
  let message: string;
  
  if (conflict) {
    // Show conflict details
    const conflictMessage = CONFLICT_MESSAGES[conflict.type] || 'Conflict detected';
    message = `LiveSync (check): ${conflictMessage}.`;
  } else {
    // Show generic success message
    message = `LiveSync (check): No conflict detected.`;
  }
  
  // Show info notification (non-blocking)
  vscode.window.showInformationMessage(message);
}