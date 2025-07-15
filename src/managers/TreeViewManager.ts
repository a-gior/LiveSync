// src/TreeViewManager.ts
import * as vscode from 'vscode';
import { SyncTreeDataProvider } from '../services/SyncTreeDataProvider';
import { WorkspaceTreeDataProvider } from '../services/WorkspaceTreeDataProvider';
import { ComparisonFileNode, ComparisonStatus } from '../utilities/ComparisonFileNode';
import { configManager } from '../extension';

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
      const workspaceConfig = configManager!.getConfig(event.element.workspaceFolder.uri);
      workspaceConfig.jsonStore.updateFolderState(event.element.relativePath, true);
    });
    this._diffView.onDidCollapseElement(event => {
      const workspaceConfig = configManager!.getConfig(event.element.workspaceFolder.uri);
      workspaceConfig.jsonStore.updateFolderState(event.element.relativePath, false);
    });

    // 6) When a workspace folder is selected, reload diffs for that folder
    this._workspaceView.onDidChangeSelection(async event => {
      const folder = event.selection[0];
      if (folder) {
        this._diffProvider.currentWorkspace = folder;
        await this._diffProvider.refresh();

        this._diffView.title = `Diffs — ${folder.name ?? "No Workspace"}`;
      }
    });

    // 7) Load initial diff tree
    this._diffView.title = `Diffs — ${this._diffProvider.currentWorkspace.name ?? "No Workspace"}`;
    await this._diffProvider.refresh();
    

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

  /**
   * Updates the “No items / No differences” message based on diff data
   */
  public static updateMessage(provider: SyncTreeDataProvider): void {
    const root = provider.displayedComparisonNode;

    if(!root) {return;}

    // 1. No items under the root?
    if (root.listChildren().length === 0) {
      this._diffView.message = 'No items to display';
      return;
    }

    // 2. If we're configured to show unchanged, always clear
    if (provider.settings.showUnchanged) {
      this._diffView.message = '';
      return;
    }

    // 3. Otherwise do a simple stack-based DFS looking for any status ≠ unchanged
    let hasDifference = false;
    const stack: ComparisonFileNode[] = [root];

    while (stack.length > 0 && !hasDifference) {
      const node = stack.pop()!;
      if (node.status !== ComparisonStatus.unchanged) {
        hasDifference = true;
        break;
      }
      stack.push(...node.listChildren());
    }

    this._diffView.message = hasDifference ? '' : 'No differences found';
  }
}
