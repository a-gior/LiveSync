// src/TreeViewManager.ts
import * as vscode from 'vscode';
import JsonManager from './JsonManager';
import { SyncTreeDataProvider } from '../services/SyncTreeDataProvider';
import { WorkspaceTreeDataProvider } from '../services/WorkspaceTreeDataProvider';
import { ComparisonFileNode, ComparisonStatus } from '../utilities/ComparisonFileNode';

export class TreeViewManager {
  private static _workspaceView: vscode.TreeView<vscode.WorkspaceFolder>;
  private static _workspaceProvider: WorkspaceTreeDataProvider;
  private static _diffView: vscode.TreeView<ComparisonFileNode>;
  private static _diffProvider: SyncTreeDataProvider;

  /** Initialize both Workspaces and Diffs views and wire them together */
  public static async initialize(context: vscode.ExtensionContext): Promise<SyncTreeDataProvider> {
    // 1) Read persisted settings for diff view
    const showAsTree    = context.globalState.get<boolean>('showAsTree', false);
    const showUnchanged = context.globalState.get<boolean>('showUnchanged', false);
    const collapseAll   = context.globalState.get<boolean>('collapseAll', false);

    // 2) Create the Workspaces tree
    this._workspaceProvider = new WorkspaceTreeDataProvider();
    this._workspaceView = vscode.window.createTreeView('livesync.workspaces', {
      treeDataProvider: this._workspaceProvider,
      showCollapseAll:  false
    });

    // 3) Create the Diffs tree
    this._diffProvider = new SyncTreeDataProvider(showAsTree, showUnchanged, collapseAll);
    this._diffView = vscode.window.createTreeView('livesync.diffs', {
      treeDataProvider: this._diffProvider
    });
    this._diffView.message = 'Loading…';

    // 4) Set contexts for UI contributions
    vscode.commands.executeCommand('setContext', 'livesyncViewMode',    showAsTree    ? 'tree'   : 'list');
    vscode.commands.executeCommand('setContext', 'livesyncShowUnchanged', showUnchanged);
    vscode.commands.executeCommand('setContext', 'livesyncExpandMode', collapseAll   ? 'collapse' : 'expand');

    // 5) Wire expand/collapse events to JsonManager
    this._diffView.onDidExpandElement(event => {
      JsonManager.getInstance().updateFolderState(event.element, true);
    });
    this._diffView.onDidCollapseElement(event => {
      JsonManager.getInstance().updateFolderState(event.element, false);
    });

    // 6) When a workspace folder is selected, reload diffs for that folder
    this._workspaceView.onDidChangeSelection(async event => {
      const folder = event.selection[0];
      if (folder) {
        this._diffProvider.currentWorkspace = folder;
        await this._diffProvider.refresh();
        this.updateMessage(this._diffProvider);
      }
    });

    // 7) Load initial diff tree and update message
    await this._diffProvider.refresh();
    this.updateMessage(this._diffProvider);

    // 8) Clean up on deactivate
    context.subscriptions.push(this._workspaceView, this._diffView);

    return this._diffProvider;
  }

  public static get diffProvider() {
    return this._diffProvider;
  }

  public static get diffView() {
    return this._diffView;
  }

  /** Updates the “No items / No differences” message based on diff data */
  public static updateMessage(provider: SyncTreeDataProvider) {
    if (provider.rootElements.size === 0) {
      this._diffView.message = 'No items to display';
      return;
    }
    if (provider.settings.showUnchanged) {
      this._diffView.message = '';
      return;
    }

    let hasDifference = false;
    const dfs = (node: ComparisonFileNode) => {
      if (hasDifference) return;
      if (node.status !== ComparisonStatus.unchanged) {
        hasDifference = true;
        return;
      }
      for (const child of node.children.values()) {
        dfs(child);
        if (hasDifference) return;
      }
    };

    for (const rootNode of provider.rootElements.values()) {
      dfs(rootNode);
      if (hasDifference) break;
    }

    this._diffView.message = hasDifference ? '' : 'No differences found';
  }
}
