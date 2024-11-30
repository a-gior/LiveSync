import * as vscode from "vscode";
import * as path from "path";
import { FileNode, getFileNodeInfo } from "../utilities/FileNode";
import { PairedFoldersTreeDataProvider } from "./PairedFoldersTreeDataProvider";

import {
  fileCreate,
  fileDelete,
  fileMove,
  fileSave,
} from "../utilities/fileUtils/fileEventFunctions";
import { WorkspaceConfig } from "./WorkspaceConfig";
import {
  ComparisonFileNode,
  ComparisonStatus,
} from "../utilities/ComparisonFileNode";
import FileNodeManager from "./FileNodeManager";
import { Action } from "../utilities/enums";
import { logInfoMessage } from "./LogManager";

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
        await FileEventHandler.handleFileCreate(event, treeDataProvider);
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
      // vscode.workspace.onDidChangeTextDocument(async (event) => {
      //   await FileEventHandler.handleFileChange(event, treeDataProvider);
      // }),

      // Handle file save events
      vscode.workspace.onDidSaveTextDocument(async (document) => {
        await FileEventHandler.handleFileSave(document, treeDataProvider);
      }),

      // Handle configuration changes
      vscode.workspace.onDidChangeConfiguration(() => {
        WorkspaceConfig.reloadConfiguration();
        logInfoMessage("<onDidChangeConfiguration> Reloaded settings");
      }),
    );
  }

  /**
   * Checks if the given file path is within the workspace folders.
   * @param filePath - The file path to check
   * @returns True if the file is in the workspace, false otherwise
   */
  static isFileInWorkspace(filePath: string): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return false;
    }
    return workspaceFolders.some((folder) =>
      filePath.startsWith(folder.uri.fsPath),
    );
  }

  /**
   * Logs a message indicating that the file is not in the workspace.
   * @param action - The action that was attempted (e.g., "creating", "deleting", "saving")
   * @param filePath - The file path
   */
  static logFileNotInWorkspace(action: string, filePath: string): void {
    console.log(
      `<handleFile${action}> Event ${action} ${filePath} not in workspace, we do nothing`,
    );
  }

  static isSettingsFile(action: string, filePath: string): boolean {
    // Get the workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders) {
      // Iterate over all workspace folders and check for the settings file path
      for (const workspaceFolder of workspaceFolders) {
        const settingsPath = path.join(
          workspaceFolder.uri.fsPath,
          ".vscode",
          "settings.json",
        );
        if (filePath === settingsPath) {
          console.log(
            `<handleFile${action}> Detected configuration file at ${filePath}, skipping further processing of this event.`,
          );
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Handle file create events.
   * @param event - The file create event
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileCreate(
    event: vscode.FileCreateEvent,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    for (const fileUri of event.files) {
      const filePath = fileUri.fsPath;

      if (!FileEventHandler.isFileInWorkspace(filePath)) {
        FileEventHandler.logFileNotInWorkspace("Create", filePath);
        continue;
      }

      if (FileEventHandler.isSettingsFile(Action.Add, filePath)) {
        continue;
      }

      console.log(`<handleFileCreate> Event creating ${filePath}`);

      try {
        // Save the newly created file
        const fileCreated = await fileCreate(fileUri);

        const fileNode = await FileNode.getEntryFromLocalPath(filePath);
        const comparisonNode = new ComparisonFileNode(
          fileNode.name,
          fileNode.pairedFolderName,
          fileNode.type,
          fileNode.size,
          fileNode.modifiedTime,
          fileNode.relativePath,
          ComparisonStatus.added,
        );

        if (!comparisonNode) {
          console.warn(
            `[handleFileCreate] File node for ${filePath} could not be found in comparison JSON.`,
          );
          continue;
        }

        if (fileCreated) {
          comparisonNode.status = ComparisonStatus.unchanged;
        }

        const updatedNode = await treeDataProvider.updateRootElements(
          Action.Add,
          comparisonNode,
        );
        await treeDataProvider.refresh(updatedNode);
      } catch (err: any) {
        console.error("[handleFileCreate] Error: ", err);
      }
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
      const filePath = fileUri.fsPath;

      if (!FileEventHandler.isFileInWorkspace(filePath)) {
        FileEventHandler.logFileNotInWorkspace("Delete", filePath);
        continue;
      }

      if (FileEventHandler.isSettingsFile(Action.Remove, filePath)) {
        continue;
      }

      console.log(`<handleFileDelete> Event deleting ${filePath}`);

      try {
        const nodeToDelete = await FileNodeManager.findEntryByPath(
          filePath,
          treeDataProvider.rootElements,
        );
        if (!nodeToDelete) {
          console.warn(`<handleFileDelete> Entry not found for ${filePath}`);
          return;
        }

        let fileDeleted = false;
        if (nodeToDelete.status !== ComparisonStatus.added) {
          // If file exists on remote
          fileDeleted = await fileDelete(fileUri);
          nodeToDelete.status = fileDeleted
            ? ComparisonStatus.removed
            : nodeToDelete.status;
        }
        const action = fileDeleted ? Action.Remove : Action.Update;

        const deletedNode = await treeDataProvider.updateRootElements(
          action,
          nodeToDelete,
        );
        await treeDataProvider.refresh(deletedNode);
      } catch (err: any) {
        console.error("<handleFileDelete> Error: ", err);
      }
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

    if (!FileEventHandler.isFileInWorkspace(filePath)) {
      FileEventHandler.logFileNotInWorkspace("Save", filePath);
      return;
    }

    if (FileEventHandler.isSettingsFile(Action.Save, filePath)) {
      return;
    }

    console.log(`<handleFileSave> Event saving ${filePath}`);

    try {
      const nodeToSave = await FileNodeManager.findEntryByPath(
        filePath,
        treeDataProvider.rootElements,
      );
      if (!nodeToSave) {
        console.warn(`<handleFileRename> Entry not found for ${filePath}`);
        return;
      }

      const fileSaved = await fileSave(document.uri, treeDataProvider);
      if (fileSaved) {
        nodeToSave.status = ComparisonStatus.unchanged;
      }

      const savedNode = await treeDataProvider.updateRootElements(
        Action.Update,
        nodeToSave,
      );
      await treeDataProvider.refresh(savedNode);
    } catch (err: any) {
      console.error("<handleFileSave> Error: ", err);
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
      const oldPath = oldUri.fsPath;
      const newPath = newUri.fsPath;

      if (
        !FileEventHandler.isFileInWorkspace(oldPath) ||
        !FileEventHandler.isFileInWorkspace(newPath)
      ) {
        FileEventHandler.logFileNotInWorkspace("Rename", oldPath);
        continue;
      }

      if (
        FileEventHandler.isSettingsFile(Action.Move, oldPath) ||
        FileEventHandler.isSettingsFile(Action.Move, newPath)
      ) {
        return;
      }

      console.log(
        `<handleFileRename> Event renaming/moving from ${oldPath} to ${newPath}`,
      );

      try {
        const nodeToRename = await FileNodeManager.findEntryByPath(
          oldPath,
          treeDataProvider.rootElements,
        );
        if (!nodeToRename) {
          console.warn(`<handleFileRename> Entry not found for ${oldPath}`);
          continue;
        }

        const oldFileNodeInfo = getFileNodeInfo(oldPath);
        const newFileNodeInfo = getFileNodeInfo(newPath);
        if (!oldFileNodeInfo || !newFileNodeInfo) {
          console.warn(
            `<handleFileRename> FileNodeInfo not found for ${oldPath} or ${newPath}`,
          );
          continue;
        }

        let fileRenamed = false;
        if (nodeToRename.status !== ComparisonStatus.added) {
          fileRenamed = await fileMove(oldUri, newUri);
        } else {
          // Only exists locally
          fileRenamed = true;
        }

        if (fileRenamed) {
          nodeToRename.status =
            nodeToRename.status !== ComparisonStatus.added
              ? ComparisonStatus.unchanged
              : ComparisonStatus.added;

          nodeToRename.relativePath = oldFileNodeInfo.relativePath;
          const deletedNode = await treeDataProvider.updateRootElements(
            Action.Remove,
            nodeToRename,
          );
          await treeDataProvider.refresh(deletedNode);

          if (path.dirname(oldPath) === path.dirname(newPath)) {
            // Renaming the entry
            nodeToRename.name = path.basename(newPath);
          }

          nodeToRename.relativePath = newFileNodeInfo.relativePath;
          const movedNode = await treeDataProvider.updateRootElements(
            Action.Add,
            nodeToRename,
          );
          await treeDataProvider.refresh(movedNode);
        } else {
          nodeToRename.status = ComparisonStatus.removed;
          nodeToRename.relativePath = oldFileNodeInfo.relativePath;
          const deletedNode = await treeDataProvider.updateRootElements(
            Action.Update,
            nodeToRename,
          );
          await treeDataProvider.refresh(deletedNode);

          const nodeToAdd = nodeToRename.clone();
          if (path.dirname(oldPath) === path.dirname(newPath)) {
            // Renaming the entry
            nodeToAdd.name = path.basename(newPath);
          }
          nodeToAdd.status = ComparisonStatus.added;
          nodeToAdd.relativePath = newFileNodeInfo.relativePath;
          const addedNode = await treeDataProvider.updateRootElements(
            Action.Add,
            nodeToAdd,
          );
          await treeDataProvider.refresh(addedNode);
        }
      } catch (err: any) {
        console.error("<handleFileRename> Error: ", err);
      }
    }
  }

  /**
   * Handle file change events.
   * @param event - The text document change event
   * @param treeDataProvider - The tree data provider
   */
  // static async handleFileChange(
  //   event: vscode.TextDocumentChangeEvent,
  //   treeDataProvider: PairedFoldersTreeDataProvider,
  // ) {
  //   // NOTHING TO DO WHEN CHANGES OCCURS IN DOCUMENTS
  // }
}
