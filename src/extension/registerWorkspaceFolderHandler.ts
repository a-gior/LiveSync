import * as vscode from 'vscode';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { stringToWsId } from '@helpers/path';

/**
 * Registers handler for workspace folder changes (add/remove)
 * Updates workspace list view and validates new folders
 */
export function registerWorkspaceFolderHandler(
  validator: ConfigValidator,
  workspaceListProvider: WorkspaceListProvider | undefined,
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      // Handle removed folders
      for (const removed of event.removed) {
        const wsId = stringToWsId(removed.uri.fsPath);
        console.log('[WorkspaceFolders] Removed:', wsId);
        
        workspaceListProvider?.removeWorkspace(wsId);
        validator.clearCache(wsId);
      }

      // Handle added folders
      for (const added of event.added) {
        const wsId = stringToWsId(added.uri.fsPath);
        console.log('[WorkspaceFolders] Added:', wsId);
        
        workspaceListProvider?.addWorkspace(wsId);
        
        // Validate the new folder
        const result = await validator.validate(added, false, true);
        
        workspaceListProvider?.updateConfigStatus(
          result.workspaceId,
          result.hasConfig,
          result.isValid
        );
      }

      // Update multi-root context
      const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', isMultiRoot);
    })
  );
}