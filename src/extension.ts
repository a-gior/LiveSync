// Main entry point for the LiveSync extension
import * as vscode from "vscode";
import { EventManager } from "./managers/EventManager";
import { TreeViewManager } from "./managers/TreeViewManager";
import { StatusBarManager } from "./managers/StatusBarManager";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import { WorkspaceConfigManager } from "./managers/WorkspaceConfigManager";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./managers/LogManager";
import { ConnectionManager } from "./managers/ConnectionManager";
import { CommandRegistrar } from "./services/CommandRegistrar";
import { WorkspaceConfigManager2 } from "./managers/WorkspaceConfigManager2";

export let configManager: WorkspaceConfigManager2 | null = null;

export async function activate(context: vscode.ExtensionContext) {
  logInfoMessage("LiveSync extension activating...");

  // Only activate Livesync if there is a single folder in the workspace
  // if (WorkspaceConfigManager.isMultiRootWorkspace()) {
  //   logErrorMessage(
  //     "LiveSync requires a single folder in the workspace to configure correctly. Please ensure only one folder is selected.",
  //     LOG_FLAGS.ALL
  //   );
  //   return;
  // }
  
  // Register file status decoration provider
  const fileStatusDecorationProvider = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider));

  // Initialize managers
  configManager = new WorkspaceConfigManager2(context);
  configManager.loadConfigs();
  await TreeViewManager.initialize(context);
  CommandRegistrar.register(context, TreeViewManager.treeDataProvider);
  WorkspaceConfigManager.initialize(context);
  EventManager.initialize(context, TreeViewManager.treeDataProvider);
  StatusBarManager.createPermanentIcon();

  try {
    await ConnectionManager.getInstance(WorkspaceConfigManager.getRemoteServerConfigured());
  } catch(error: any) {
    logErrorMessage(error.message, LOG_FLAGS.ALL);
  }

  logInfoMessage("LiveSync extension activated.");
  
}

export function deactivate() {
  logInfoMessage("Deactivating LiveSync extension...");
}
