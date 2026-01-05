import * as vscode from 'vscode';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { ConfigStatusBar } from '@presentation/statusbar/ConfigStatusBar';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { stringToWsId } from '@helpers/path';
import { SyncStateManager } from '@app/SyncStateManager';
import { ExperimentalTreeProvider } from '@presentation/tree/ExperimentalTreeProvider';
import { FolderStateStore } from '@presentation/tree/FolderStateStore';

/**
 * Registers handler for workspace folder changes (add/remove)
 * Updates workspace list view, config status bar, and validates new folders
 * Dynamically creates workspace list view when transitioning from single→multi-root
 */
export function registerWorkspaceFolderHandler(
  config: WorkspaceConfigService,
  validator: ConfigValidator,
  state: SyncStateManager,
  diffsProvider: ExperimentalTreeProvider,
  folderState: FolderStateStore,
  workspaceState: vscode.Memento,
  configStatusBar: ConfigStatusBar,
  context: vscode.ExtensionContext,
  services: {
    provider?: WorkspaceListProvider;
    view?: vscode.TreeView<any>;
  }
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      const wasMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) - event.added.length + event.removed.length > 1;
      const isNowMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;

      // Handle removed folders
      for (const removed of event.removed) {
        const wsId = stringToWsId(removed.uri.fsPath);
        console.log('[WorkspaceFolders] Removed:', wsId);
        
        services.provider?.removeWorkspace(wsId);
        validator.clearCache(wsId);
        configStatusBar.removeWorkspace(wsId);
      }

      // Handle added folders
      for (const added of event.added) {
        const wsId = stringToWsId(added.uri.fsPath);
        console.log('[WorkspaceFolders] Added:', wsId);
        
        // If transitioning from single→multi-root, create workspace list view
        if (!wasMultiRoot && isNowMultiRoot && !services.provider) {
          console.log('[WorkspaceFolders] Creating workspace list view (single→multi-root transition)');
          
          const allWorkspaceIds = (vscode.workspace.workspaceFolders ?? []).map(f => stringToWsId(f.uri.fsPath));
          
          services.provider = new WorkspaceListProvider(
            allWorkspaceIds,
            (selectedWsId) => {
              diffsProvider.setCurrentWorkspace(selectedWsId);
            },
            workspaceState
          );

          services.view = vscode.window.createTreeView('livesync.workspaces', {
            treeDataProvider: services.provider,
            showCollapseAll: false,
          });

          context.subscriptions.push(services.view);
          
          // Initialize config statuses for all existing workspaces
          for (const workspaceId of allWorkspaceIds) {
            const folder = vscode.workspace.workspaceFolders?.find(
              f => stringToWsId(f.uri.fsPath) === workspaceId
            );
            if (folder) {
              const result = await validator.validate(folder, false, true);
              services.provider.updateConfigStatus(
                result.workspaceId,
                result.hasConfig,
                result.isValid
              );
            }
          }

          // Restore selection
          services.provider.restoreSelection();
        } else {
          // Just add the new workspace to existing provider
          services.provider?.addWorkspace(wsId);
        }
        
        // Validate the new folder
        const result = await validator.validate(added, false, true);
        
        services.provider?.updateConfigStatus(
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
      await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', isNowMultiRoot);
    })
  );
}