// File: src/extension/registerWorkspaceFolderHandler.ts
// Updated for event-driven validation

import * as vscode from 'vscode';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { ConfigStatusBar } from '@presentation/statusbar/ConfigStatusBar';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { stringToWsId } from '@helpers/path';
import { SyncStateTreeProvider } from '@presentation/tree/SyncStateTreeProvider';
import { findWorkspaceFolderById } from '../infrastructure/helpers/workspaceFolder';

/**
 * Registers handler for workspace folder changes (add/remove)
 * Updates workspace list view, config status bar, and validates new folders
 * Dynamically creates workspace list view when transitioning from single→multi-root
 */
export function registerWorkspaceFolderHandler(
  validator: ConfigValidator,
  diffsProvider: SyncStateTreeProvider,
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
        
        // If transitioning from single→multi-root, create workspace list view
        if (!wasMultiRoot && isNowMultiRoot && !services.provider) {
          const allWorkspaceIds = (vscode.workspace.workspaceFolders ?? []).map(f => stringToWsId(f.uri.fsPath));
          
          services.provider = new WorkspaceListProvider(
            allWorkspaceIds,
            (selectedWsId) => {
              diffsProvider.setCurrentWorkspace(selectedWsId);
            },
            workspaceState,
            validator  // Pass validator for event subscription
          );

          services.view = vscode.window.createTreeView('livesync.workspaces', {
            treeDataProvider: services.provider,
            showCollapseAll: false,
          });

          context.subscriptions.push(services.view);
          
          // Validate all existing workspaces (emits events → provider auto-updates)
          for (const workspaceId of allWorkspaceIds) {
            const folder = findWorkspaceFolderById(workspaceId);
            if (folder) {
              await validator.validate(folder, false, true);
            }
          }

          // Restore selection
          services.provider.restoreSelection();
        } else {
          // Just add the new workspace to existing provider
          services.provider?.addWorkspace(wsId);
        }
        
        // Validate the new folder (emits event → status bar + workspace list auto-update)
        await validator.validate(added, false, true);
      }

      // Update multi-root context
      await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', isNowMultiRoot);
    })
  );
}