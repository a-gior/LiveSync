import * as vscode from 'vscode';
import { WorkspaceId } from '@domain/types';
import { SyncStateManager } from '@app/SyncStateManager';
import { FolderStateStore } from '@presentation/tree/FolderStateStore';
import { ExperimentalTreeProvider } from '@presentation/tree/ExperimentalTreeProvider';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { logInfoMessage } from '@helpers/logging';

interface WorkspaceViews {
  diffsProvider: ExperimentalTreeProvider;
  diffsView: vscode.TreeView<any>;
  listProvider?: WorkspaceListProvider;
  listView?: vscode.TreeView<any>;
}

export function setupWorkspaceViews(
  workspaceIds: WorkspaceId[],
  state: SyncStateManager,
  folderState: FolderStateStore,
  workspaceState: vscode.Memento
): WorkspaceViews {
  const isMultiRoot = workspaceIds.length > 1;
  
  logInfoMessage('[VIEWS] Setting up views...');
  
  const initialWorkspace = workspaceIds[0];
  const diffsProvider = new ExperimentalTreeProvider(state, initialWorkspace, folderState);
  
  // Wrap in try-catch to handle race condition with view registration
  let diffsView: vscode.TreeView<any>;
  try {
    logInfoMessage('[VIEWS] Creating livesync.diffs view...');
    diffsView = vscode.window.createTreeView('livesync.diffs', { 
      treeDataProvider: diffsProvider 
    });
    logInfoMessage('[VIEWS] livesync.diffs view created successfully');
  } catch (err) {
    logInfoMessage(`[VIEWS] Failed to create livesync.diffs view: ${err}`);
    throw err;
  }

  let listProvider: WorkspaceListProvider | undefined;
  let listView: vscode.TreeView<any> | undefined;
  
  if (isMultiRoot) {
    logInfoMessage('[VIEWS] Creating workspace list view (multi-root)...');
    listProvider = new WorkspaceListProvider(
      workspaceIds,
      (selectedWsId) => {
        diffsProvider.setCurrentWorkspace(selectedWsId);
      },
      workspaceState
    );

    try {
      listView = vscode.window.createTreeView('livesync.workspaces', {
        treeDataProvider: listProvider,
        showCollapseAll: false,
      });
      logInfoMessage('[VIEWS] livesync.workspaces view created successfully');
    } catch (err) {
      logInfoMessage(`[VIEWS] Failed to create livesync.workspaces view: ${err}`);
      throw err;
    }

    listProvider.restoreSelection();
  }

  logInfoMessage('[VIEWS] All views setup complete');

  return {
    diffsProvider,
    diffsView,
    listProvider,
    listView,
  };
}