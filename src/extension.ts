// Main entry point for the LiveSync extension
import * as vscode from "vscode";
import { EventManager } from "./managers/EventManager";
import { TreeViewManager } from "./managers/TreeViewManager";
import { StatusBarManager } from "./managers/StatusBarManager";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import { logInfoMessage } from "./managers/LogManager";
import { CommandRegistrar } from "./services/CommandRegistrar";
import { WorkspaceConfigManager } from "./managers/WorkspaceConfigManager";
import { migrateStorageSchema } from "./services/WorkspaceJsonStore";
import { initConfigErrorSuppressor } from "./storage/ConfigErrorSuppressor";
import { initLastSelectedWorkspace } from "./storage/LastSelectedWorkspace";

export let configManager: WorkspaceConfigManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
  logInfoMessage("LiveSync extension activating...");
  await migrateStorageSchema(context);
  
  initConfigErrorSuppressor(context);
  initLastSelectedWorkspace(context);
  
  // Register file status decoration provider
  const fileStatusDecorationProvider = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider));

  // Initialize managers
  configManager = new WorkspaceConfigManager(context);
  await configManager.loadConfigs();
  await TreeViewManager.initialize(context);
  CommandRegistrar.register(context, TreeViewManager.diffProvider);
  // WorkspaceConfigManager.initialize(context);
  EventManager.initialize(context, TreeViewManager.diffProvider);
  StatusBarManager.createPermanentIcon();

  logInfoMessage("LiveSync extension activated.");
  
  return { context };
}

export function deactivate() {
  logInfoMessage("Deactivating LiveSync extension...");
}
