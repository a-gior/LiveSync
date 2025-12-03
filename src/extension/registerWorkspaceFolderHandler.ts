import * as vscode from 'vscode';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { ConfigStatusBar } from '@presentation/statusbar/ConfigStatusBar';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { stringToWsId } from '@helpers/path';

/**
 * Registers handler for workspace folder changes (add/remove)
 * Updates workspace list view, config status bar, and validates new folders
 */
export function registerWorkspaceFolderHandler(
  config: WorkspaceConfigService,
  validator: ConfigValidator,
  workspaceListProvider: WorkspaceListProvider | undefined,
  configStatusBar: ConfigStatusBar,
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
        configStatusBar.removeWorkspace(wsId);
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

        // Update config status bar
        let hostname: string | undefined;
        let remotePath: string | undefined;
        
        if (result.isValid) {
          try {
            const cfg = await config.get(added);
            hostname = cfg.data.hostname;
            remotePath = cfg.data.remotePath;
          } catch {
            // Ignore
          }
        }
        
        configStatusBar.updateWorkspaceStatus(
          result.workspaceId,
          result,
          hostname,
          remotePath,
          added.name
        );
      }

      // Update multi-root context
      const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', isMultiRoot);
    })
  );
}