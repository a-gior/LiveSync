import * as vscode from 'vscode';
import type { WorkspaceId } from '@domain/types';
import { Services } from '../../../extension/services';
import { findWorkspaceFolderById } from '../workspaceFolder';

/**
 * Check if workspace has valid remote config before executing remote commands
 * Shows helpful error message if not valid
 * 
 * @returns true if valid, false if not
 */
export async function requireValidRemoteConfig(
  services: Services, 
  workspaceId: WorkspaceId
): Promise<boolean> {
  const folder = findWorkspaceFolderById(workspaceId);

  // Check cached validation result
  const validationResult = services.validator.getCached(workspaceId);
  
  if (!validationResult.hasConfig) {
    const choice = await vscode.window.showWarningMessage(
      'No remote server configured. Configure remote sync?',
      'Configure',
    );
    
    if (choice === 'Configure') {
      await vscode.commands.executeCommand('livesync.configuration', folder);
    }
    return false;
  }
  
  if (!validationResult.isValid) {
    const errorMsg = validationResult.error || 'Invalid configuration';
    const choice = await vscode.window.showErrorMessage(
      `Remote configuration error: ${errorMsg}`,
      'Fix Configuration',
    );
    
    if (choice === 'Fix Configuration') {
      await vscode.commands.executeCommand('livesync.configuration', folder);
    }
    return false;
  }
  
  return true;
}