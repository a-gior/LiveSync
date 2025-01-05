import * as vscode from "vscode";
import { FileEventHandler } from "../services/FileEventHandler";
import { PairedFoldersTreeDataProvider } from "../services/PairedFoldersTreeDataProvider";
import { WorkspaceConfigManager } from "./WorkspaceConfigManager";

export class EventManager {
  static initialize(context: vscode.ExtensionContext): void {
    WorkspaceConfigManager.initialize();
    FileEventHandler.initialize(context, new PairedFoldersTreeDataProvider());
  }
}
