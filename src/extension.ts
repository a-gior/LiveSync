// Main entry point for the LiveSync extension
import * as vscode from "vscode";
import { CommandManager } from "./managers/CommandManager";
import { EventManager } from "./managers/EventManager";
import { TreeViewManager } from "./managers/TreeViewManager";
import { StatusBarManager } from "./managers/StatusBarManager";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import { WorkspaceConfigManager } from "./managers/WorkspaceConfigManager";
import { LOG_FLAGS, logConfigError, logErrorMessage, logInfoMessage } from "./managers/LogManager";

export async function activate(context: vscode.ExtensionContext) {
  // Only activate Livesync if there is a single folder in the workspace
  if (WorkspaceConfigManager.isMultiRootWorkspace()) {
    logErrorMessage(
      "LiveSync requires a single folder in the workspace to configure correctly. Please ensure only one folder is selected.",
      LOG_FLAGS.ALL
    );
    return;
  }

  if (!(await WorkspaceConfigManager.isVSCodeConfigValid())) {
    logConfigError();
  }

  // Register file status decoration provider
  const fileStatusDecorationProvider = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider));

  // Initialize managers
  const treeDataProvider = await TreeViewManager.initialize(context);
  EventManager.initialize(context, treeDataProvider);
  StatusBarManager.createPermanentIcon();
  CommandManager.registerCommands(context, treeDataProvider);

  logInfoMessage("LiveSync extension activated.");
}

export function deactivate() {
  logInfoMessage("Deactivating LiveSync extension...");
}
