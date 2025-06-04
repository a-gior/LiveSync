import * as vscode from "vscode";
import { FileEventHandler } from "../services/FileEventHandler";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";

export class EventManager {
  static initialize(context: vscode.ExtensionContext, treeDataProvider: SyncTreeDataProvider): void {
    FileEventHandler.initialize(context, treeDataProvider);
  }
}
