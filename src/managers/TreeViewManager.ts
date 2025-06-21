import * as vscode from "vscode";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import JsonManager from "./JsonManager";
import { ComparisonFileNode, ComparisonStatus } from "../utilities/ComparisonFileNode";

export class TreeViewManager {
  
  private static _treeView: vscode.TreeView<ComparisonFileNode>;
  private static _treeDataProvider: SyncTreeDataProvider;

  public static get treeView() {
    return this._treeView;
  }
  
  public static get treeDataProvider() {
    return this._treeDataProvider;
  }

  static async initialize(context: vscode.ExtensionContext): Promise<SyncTreeDataProvider> {
    const showAsTree = context.globalState.get<boolean>("showAsTree", false);
    const showUnchanged = context.globalState.get<boolean>("showUnchanged", false);
    const collapseAll = context.globalState.get<boolean>("collapseAll", false);

    const treeDataProvider = new SyncTreeDataProvider(showAsTree, showUnchanged, collapseAll);
    this._treeView = vscode.window.createTreeView("treeViewId", {
      treeDataProvider: treeDataProvider
    });
    this._treeView.message = "Loading…";

    vscode.commands.executeCommand("setContext", "livesyncViewMode", showAsTree ? "tree" : "list");
    vscode.commands.executeCommand("setContext", "livesyncShowUnchanged", showUnchanged);
    vscode.commands.executeCommand("setContext", "livesyncExpandMode", collapseAll ? "collapse" : "expand");

    this._treeView.onDidExpandElement((event) => {
      JsonManager.getInstance().updateFolderState(event.element, true);
    });

    this._treeView.onDidCollapseElement((event) => {
      JsonManager.getInstance().updateFolderState(event.element, false);
    });

    await treeDataProvider.loadRootElements();
    this.updateMessage(treeDataProvider);

    context.subscriptions.push(this._treeView);

    return treeDataProvider;
  }

  public static updateMessage(provider: SyncTreeDataProvider) {
    if (provider.rootElements.size === 0) {
      this._treeView.message = "No items to display";
      return;
    }

    if (provider.settings.showUnchanged) {
      this._treeView.message = "";
      return;
    }

    let hasDifference = false;

    const dfs = (node: ComparisonFileNode) => {
      if (hasDifference) {
        return;
      }
      if (node.status !== ComparisonStatus.unchanged) {
        hasDifference = true;
        return;
      }
      for (const child of node.children.values()) {
        dfs(child);
        if (hasDifference) {
          return;
        }
      }
    };

    for (const rootNode of provider.rootElements.values()) {
      dfs(rootNode);
      if (hasDifference) {
        break;
      }
    }

    if (!hasDifference) {
      this._treeView.message = "No differences found";
    } else {
      this._treeView.message = "";
    }
  }
}
