import * as vscode from "vscode";
import * as path from "path";
import { FileNode, FileNodeStatus } from "../utilities/FileNode";
import { PairedFoldersTreeDataProvider } from "./PairedFoldersTreeDataProvider";

import {
  fileDelete,
  fileMove,
  fileSave,
} from "../utilities/fileUtils/fileEventFunctions";
import { WorkspaceConfig } from "./WorkspaceConfig";

export class FileEventHandler {
  /**
   * Initialize file event handlers and register them in the extension context.
   * @param context - The extension context
   * @param treeDataProvider - The tree data provider
   */
  static initialize(
    context: vscode.ExtensionContext,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    context.subscriptions.push(
      // Handle file create events
      vscode.workspace.onDidCreateFiles(async (event) => {
        await FileEventHandler.handleFileCreate(event);
      }),

      // Handle file delete events
      vscode.workspace.onDidDeleteFiles(async (event) => {
        await FileEventHandler.handleFileDelete(event, treeDataProvider);
      }),

      // Handle file rename events
      vscode.workspace.onDidRenameFiles(async (event) => {
        await FileEventHandler.handleFileRename(event, treeDataProvider);
      }),

      // Handle file change events
      vscode.workspace.onDidChangeTextDocument(async (event) => {
        await FileEventHandler.handleFileChange(event, treeDataProvider);
      }),

      // Handle file save events
      vscode.workspace.onDidSaveTextDocument(async (document) => {
        await FileEventHandler.handleFileSave(document, treeDataProvider);
      }),

      // Handle configuration changes
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("LiveSync.actionOnSave")) {
          const config = vscode.workspace.getConfiguration("LiveSync");
          const actionOnSave = config.get<string>("actionOnSave");
          vscode.window.showInformationMessage(
            `actionOnSave is now set to ${actionOnSave}`,
          );
        }
        // treeDataProvider.refresh();
      }),
    );
  }

  /**
   * Handle file create events.
   * @param event - The file create event
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileCreate(event: vscode.FileCreateEvent) {
    for (const fileUri of event.files) {
      fileSave(fileUri)
        .then(() => {
          const newEntry = FileNode.getEntryFromLocalPath(fileUri.fsPath);
          newEntry.updateStatus(FileNodeStatus.new);

          vscode.commands.executeCommand("livesync.fileEntryRefresh", newEntry);
        })
        .catch((err: any) => {
          console.error("[handleFileCreate] Error : ", err);
        });
    }
  }

  /**
   * Handle file delete events.
   * @param event - The file delete event
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileDelete(
    event: vscode.FileDeleteEvent,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    for (const fileUri of event.files) {
      fileDelete(fileUri)
        .then(() => {
          const entryToRemove = treeDataProvider.findEntryByPath(
            fileUri.fsPath,
          );
          if (entryToRemove) {
            vscode.commands.executeCommand(
              "livesync.fileEntryRefresh",
              entryToRemove,
            );
          }
        })
        .catch((err: any) => {
          console.error("[handleFileDelete] Error : ", err);
        });
    }
  }

  /**
   * Handle file rename events.
   * @param event - The file rename event
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileRename(
    event: vscode.FileRenameEvent,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    for (const { oldUri, newUri } of event.files) {
      fileMove(oldUri, newUri)
        .then(() => {
          const entryToRenameOrMove = treeDataProvider.findEntryByPath(
            oldUri.fsPath,
          );

          if (
            entryToRenameOrMove &&
            path.dirname(oldUri.fsPath) === path.dirname(newUri.fsPath)
          ) {
            // Renaming the entry
            entryToRenameOrMove.name = path.basename(newUri.fsPath);
            entryToRenameOrMove.fullPath = newUri.fsPath;
            treeDataProvider.refresh(entryToRenameOrMove);
          } else if (entryToRenameOrMove) {
            // Moving the entry
            const oldParentEntry = treeDataProvider.findEntryByPath(
              path.dirname(oldUri.fsPath),
            );
            treeDataProvider.removeElement(entryToRenameOrMove, oldParentEntry);

            const newParentEntry = treeDataProvider.findEntryByPath(
              path.dirname(newUri.fsPath),
            );
            treeDataProvider.addElement(entryToRenameOrMove, newParentEntry);
          }
        })
        .catch((err: any) => {
          console.error("[handleFileRename] Error : ", err);
        });
    }
  }

  /**
   * Handle file change events.
   * @param event - The text document change event
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileChange(
    event: vscode.TextDocumentChangeEvent,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    const changedFileUri = event.document.uri;
    const changedEntry = treeDataProvider.findEntryByPath(
      changedFileUri.fsPath,
    );
    if (changedEntry) {
      // Perform necessary updates to the changedEntry
      // treeDataProvider.refresh(changedEntry);
    }
  }

  /**
   * Handle file save events.
   * @param document - The text document
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileSave(
    document: vscode.TextDocument,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    const filePath = document.uri.fsPath;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      console.log(
        `<handleFileSave> Event saving ${filePath} List of workspace folders that are open in the editor is empty`,
      );
      return;
    }

    const isInWorkspace = workspaceFolders.some((folder) =>
      filePath.startsWith(folder.uri.fsPath),
    );
    const isSettingsJson = filePath.endsWith("settings.json");

    if (!isInWorkspace) {
      console.log(
        `<handleFileSave> Event saving ${filePath} not in workspace, we do nothing`,
      );
      return;
    } else if (isSettingsJson) {
      WorkspaceConfig.reloadConfiguration();
      console.log(
        `<handleFileSave> Event saving ${filePath}, reloaded WorkspaceConfig`,
      );
      return;
    } else {
      console.log(`<handleFileSave> Event saving ${filePath}`);

      await fileSave(document.uri)
        .then(() => {
          const entrySaved = treeDataProvider.findEntryByPath(filePath);
          vscode.commands.executeCommand(
            "livesync.fileEntryRefresh",
            entrySaved,
          );
        })
        .catch((err: any) => {
          console.error("[handleFileSave] Error : ", err);
        });
    }
  }
}
