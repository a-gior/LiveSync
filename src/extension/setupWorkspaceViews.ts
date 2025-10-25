import * as vscode from 'vscode';
import { WorkspaceId } from '@domain/types';
import { SyncStateManager } from '@app/SyncStateManager';
import { FolderStateStore } from '@presentation/tree/FolderStateStore';
import { ExperimentalTreeProvider } from '@presentation/tree/ExperimentalTreeProvider';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';

interface WorkspaceViews {
  diffsProvider: ExperimentalTreeProvider;
  diffsView: vscode.TreeView<any>;
  listProvider?: WorkspaceListProvider;
  listView?: vscode.TreeView<any>;
}

/**
 * Sets up workspace-related views (diffs tree and workspace list for multi-root)
 */
export function setupWorkspaceViews(
  workspaceIds: WorkspaceId[],
  state: SyncStateManager,
  folderState: FolderStateStore
): WorkspaceViews {
  const isMultiRoot = workspaceIds.length > 1;
  
  // Create diffs view (always present)
  const initialWorkspace = workspaceIds[0];
  const diffsProvider = new ExperimentalTreeProvider(state, initialWorkspace, folderState);
  const diffsView = vscode.window.createTreeView('livesync.diffs', { 
    treeDataProvider: diffsProvider 
  });

  // Create workspace list view (only for multi-root)
  let listProvider: WorkspaceListProvider | undefined;
  let listView: vscode.TreeView<any> | undefined;
  
  if (isMultiRoot) {
    listProvider = new WorkspaceListProvider(
      workspaceIds,
      (selectedWsId) => {
        diffsProvider.setCurrentWorkspace(selectedWsId);
      }
    );

    listView = vscode.window.createTreeView('livesync.workspaces', {
      treeDataProvider: listProvider,
      showCollapseAll: false,
    });

    // Select first workspace by default
    if (workspaceIds.length > 0) {
      listProvider.selectWorkspace(workspaceIds[0]);
    }
  }

  return {
    diffsProvider,
    diffsView,
    listProvider,
    listView,
  };
}