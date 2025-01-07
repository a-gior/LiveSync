// Main entry point for the LiveSync extension
import * as vscode from "vscode";
import { CommandManager } from "./managers/CommandManager";
import { EventManager } from "./managers/EventManager";
import { TreeViewManager } from "./managers/TreeViewManager";
import { StatusBarManager } from "./managers/StatusBarManager";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";

export async function activate(context: vscode.ExtensionContext) {
  console.log("Activating LiveSync extension...");

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
