import * as vscode from "vscode";
import { FileEventHandler } from "../services/FileEventHandler";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import { WorkspaceConfigManager } from "./WorkspaceConfigManager";

export class EventManager {
  static initialize(
    context: vscode.ExtensionContext,
    treeDataProvider: SyncTreeDataProvider,
  ): void {
    WorkspaceConfigManager.initialize();
    FileEventHandler.initialize(context, treeDataProvider);
  }
}
