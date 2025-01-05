import * as vscode from "vscode";
import { PairedFoldersTreeDataProvider } from "../services/PairedFoldersTreeDataProvider";
import JsonManager from "./JsonManager";

export class TreeViewManager {
  static async initialize(
    context: vscode.ExtensionContext,
  ): Promise<PairedFoldersTreeDataProvider> {
    const showAsTree = context.globalState.get<boolean>("showAsTree", true);
    const showUnchanged = context.globalState.get<boolean>(
      "showUnchanged",
      true,
    );

    const treeDataProvider = new PairedFoldersTreeDataProvider(
      showAsTree,
      showUnchanged,
    );
    await treeDataProvider.loadRootElements();

    const treeView = vscode.window.createTreeView("nodeDependencies", {
      treeDataProvider: treeDataProvider,
    });

    vscode.commands.executeCommand(
      "setContext",
      "livesyncViewMode",
      showAsTree ? "tree" : "list",
    );
    vscode.commands.executeCommand(
      "setContext",
      "livesyncShowUnchanged",
      showUnchanged,
    );

    treeView.onDidExpandElement((event) => {
      JsonManager.getInstance().updateFolderState(event.element, true);
    });

    treeView.onDidCollapseElement((event) => {
      JsonManager.getInstance().updateFolderState(event.element, false);
    });

    context.subscriptions.push(treeView);

    return treeDataProvider;
  }
}
