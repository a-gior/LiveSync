import * as vscode from "vscode";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import JsonManager from "./JsonManager";
import { ComparisonFileNode } from "../utilities/ComparisonFileNode";

export class TreeViewManager {
  
  private static _treeView: vscode.TreeView<ComparisonFileNode>;

  public static get treeView() {
    return this._treeView;
  }

  static async initialize(context: vscode.ExtensionContext): Promise<SyncTreeDataProvider> {
    const showAsTree = context.globalState.get<boolean>("showAsTree", false);
    const showUnchanged = context.globalState.get<boolean>("showUnchanged", false);
    const collapseAll = context.globalState.get<boolean>("collapseAll", false);

    const treeDataProvider = new SyncTreeDataProvider(showAsTree, showUnchanged, collapseAll);
    await treeDataProvider.loadRootElements();

    this._treeView = vscode.window.createTreeView("treeViewId", {
      treeDataProvider: treeDataProvider
    });

    vscode.commands.executeCommand("setContext", "livesyncViewMode", showAsTree ? "tree" : "list");
    vscode.commands.executeCommand("setContext", "livesyncShowUnchanged", showUnchanged);
    vscode.commands.executeCommand("setContext", "livesyncExpandMode", collapseAll ? "collapse" : "expand");

    this._treeView.onDidExpandElement((event) => {
      JsonManager.getInstance().updateFolderState(event.element, true);
    });

    this._treeView.onDidCollapseElement((event) => {
      JsonManager.getInstance().updateFolderState(event.element, false);
    });

    context.subscriptions.push(this._treeView);

    return treeDataProvider;
  }
}
