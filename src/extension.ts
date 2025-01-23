// Main entry point for the LiveSync extension
import * as vscode from "vscode";
import { CommandManager } from "./managers/CommandManager";
import { EventManager } from "./managers/EventManager";
import { TreeViewManager } from "./managers/TreeViewManager";
import { StatusBarManager } from "./managers/StatusBarManager";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import { WorkspaceConfigManager } from "./managers/WorkspaceConfigManager";
import { LOG_FLAGS, logErrorMessage } from "./managers/LogManager";

export async function activate(context: vscode.ExtensionContext) {
  console.log("Activating LiveSync extension...");

  // Only activate Livesync if there is a single folder in the workspace
  if (WorkspaceConfigManager.isMultiRootWorkspace()) {
    logErrorMessage(
      "LiveSync requires a single folder in the workspace to configure correctly. Please ensure only one folder is selected.",
      LOG_FLAGS.ALL,
    );
    return;
  }

  // Register file status decoration provider
  const fileStatusDecorationProvider = new FileStatusDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider),
  );

  // Initialize managers
  EventManager.initialize(context);
  StatusBarManager.createPermanentIcon();
  const treeDataProvider = await TreeViewManager.initialize(context);
  CommandManager.registerCommands(context, treeDataProvider);

  console.log("LiveSync extension activated.");
}

export function deactivate() {
  console.log("Deactivating LiveSync extension...");
}
