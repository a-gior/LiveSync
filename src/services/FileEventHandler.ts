import * as vscode from "vscode";
import * as path from "path";
import { FileNode, getFileNodeInfo } from "../utilities/FileNode";
import { PairedFoldersTreeDataProvider } from "./PairedFoldersTreeDataProvider";

import {
  fileCreate,
  fileDelete,
  fileMove,
  fileOpen,
  fileSave,
  handleFileCheck,
} from "../utilities/fileUtils/fileEventFunctions";
import { WorkspaceConfig } from "./WorkspaceConfig";
import {
  ComparisonFileNode,
  ComparisonStatus,
} from "../utilities/ComparisonFileNode";
import JsonManager from "./JsonManager";
import { Action, ActionOn, ActionResult } from "../utilities/enums";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { getFullPaths } from "../utilities/fileUtils/filePathUtils";
import { ConnectionManager } from "./ConnectionManager";

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

      vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!editor) {
          // If there's no active text editor, return early
          return;
        }

        // Get the current document from the active text editor
        const document = editor.document;

        await FileEventHandler.handleFileOpen(document, treeDataProvider);
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
      vscode.workspace.onDidChangeConfiguration(async () => {
        WorkspaceConfig.reloadConfiguration();
        logInfoMessage("Reloaded settings");

        const configuration = WorkspaceConfig.getRemoteServerConfigured();
        const connectionManager = ConnectionManager.getInstance(configuration);
        if (!(await connectionManager.isServerPingable())) {
          logErrorMessage(
            "Server is not reachable. Please check your configuration.",
            LOG_FLAGS.ALL,
          );
        }
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

      logInfoMessage(`<handleFileCreate> Event creating ${filePath}`);

      try {
        // Save the newly created file depending on ActionOnSave parameter
        const fileCreatedAction = await fileCreate(fileUri);

        const fileNode = await FileNode.createFileNodeFromLocalPath(filePath);
        if (!fileNode) {
          console.warn(
            `<handleFileCreate> File node for ${filePath} could not be created`,
          );
          continue;
        }

        // Build comparison file node to add to rootElements
        const comparisonNode = new ComparisonFileNode(
          fileNode.name,
          fileNode.pairedFolderName,
          fileNode.type,
          fileNode.size,
          fileNode.modifiedTime,
          fileNode.relativePath,
        );

        // Action done or files have similar hashes
        if (
          fileCreatedAction === ActionResult.ActionPerformed ||
          fileCreatedAction === ActionResult.Exists
        ) {
          // File created on remote
          comparisonNode.status = ComparisonStatus.unchanged;
        } else if (fileCreatedAction === ActionResult.IsNotSame) {
          // File exists remotely and is different
          comparisonNode.status = ComparisonStatus.modified;
        } else {
          // File only local or doesn't exist remotely
          comparisonNode.status = ComparisonStatus.added;
        }

        // Update rootElements and refresh the tree
        const updatedNode = await treeDataProvider.updateRootElements(
          Action.Add,
          comparisonNode,
        );
        await treeDataProvider.refresh(updatedNode);
      } catch (err: any) {
        console.error("<handleFileCreate> Error: ", err);
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
        // Get node from rootElements
        const nodeToDelete = await JsonManager.findNodeByPath(
          filePath,
          treeDataProvider.rootElements,
        );
        if (!nodeToDelete) {
          console.warn(`<handleFileDelete> Node not found for ${filePath}`);
          return;
        }

        // Delete file remotely depending on ActionOnDelete parameter
        const fileDeletedAction = await fileDelete(fileUri);

        // Status becomes removed if remote file isn't deleted
        if (fileDeletedAction !== ActionResult.ActionPerformed) {
          nodeToDelete.status = ComparisonStatus.removed;
        }

        // Remove node from rootElements if also removed remotely, update it otherwise and refresh the tree view
        const action =
          fileDeletedAction === ActionResult.ActionPerformed
            ? Action.Remove
            : Action.Update;
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
      // Get node from rootElements
      const nodeToSave = await JsonManager.findNodeByPath(
        filePath,
        treeDataProvider.rootElements,
      );
      if (!nodeToSave) {
        console.warn(`<handleFileSave> Node not found for ${filePath}`);
        return;
      }

      // Save file remotely depending on ActionOnSave parameter
      const fileSavedAction = await fileSave(document.uri);

      if (fileSavedAction === ActionResult.ActionPerformed) {
        nodeToSave.status = ComparisonStatus.unchanged; // File saved remotely
      }
      if (fileSavedAction === ActionResult.DontExist) {
        nodeToSave.status = ComparisonStatus.added; // File doesn't exist remotely
      }
      if (fileSavedAction === ActionResult.Exists) {
        nodeToSave.status = ComparisonStatus.unchanged; // File exists remotely and are the same
      }
      if (fileSavedAction === ActionResult.IsNotSame) {
        nodeToSave.status = ComparisonStatus.modified; // File exists remotely and are not the same
      }

      // Update node in rootElements and refresh the tree view
      const savedNode = await treeDataProvider.updateRootElements(
        Action.Update,
        nodeToSave,
      );
      await treeDataProvider.refresh(savedNode);
      
    } catch (err: any) {
      logErrorMessage(`${err.message}`, LOG_FLAGS.ALL);
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
        // Get node from rootElements
        const nodeToMove = await JsonManager.findNodeByPath(
          oldPath,
          treeDataProvider.rootElements,
        );
        if (!nodeToMove) {
          console.warn(`<handleFileRename> Node not found for ${oldPath}`);
          continue;
        }

        // Get fileNodeInfos for old and new path
        const oldFileNodeInfo = getFileNodeInfo(oldPath);
        const newFileNodeInfo = getFileNodeInfo(newPath);
        if (!oldFileNodeInfo || !newFileNodeInfo) {
          console.warn(
            `<handleFileRename> FileNodeInfo not found for ${oldPath} or ${newPath}`,
          );
          continue;
        }

        // Get old file path and status
        const { localPath, remotePath } = await getFullPaths(nodeToMove);
        const oldFileRenamedAction = await handleFileCheck(
          ActionOn.Move,
          "check",
          localPath,
          remotePath,
        );
        const oldAction =
          oldFileRenamedAction === ActionResult.ActionPerformed
            ? Action.Remove
            : Action.Update;
        // nodeToMove.relativePath = oldFileNodeInfo.relativePath;

        // Handle
        if (oldFileRenamedAction === ActionResult.ActionPerformed) {
          nodeToMove.status = ComparisonStatus.unchanged; // File saved remotely
        }
        if (oldFileRenamedAction === ActionResult.DontExist) {
          nodeToMove.status = ComparisonStatus.added; // File doesn't exist remotely
        }
        if (oldFileRenamedAction === ActionResult.Exists) {
          nodeToMove.status = ComparisonStatus.unchanged; // File exists remotely and are the same
        }
        if (oldFileRenamedAction === ActionResult.IsNotSame) {
          nodeToMove.status = ComparisonStatus.modified; // File exists remotely and are not the same
        }

        const deletedNode = await treeDataProvider.updateRootElements(
          oldAction,
          nodeToMove,
        );
        await treeDataProvider.refresh(deletedNode);

        // Rename/Move file remotely depending on ActionOnMove parameter
        const fileRenamedAction = await fileMove(oldUri, newUri);
        const action =
          fileRenamedAction === ActionResult.ActionPerformed
            ? Action.Add
            : Action.Update;
        const nodeToAdd = nodeToMove.clone();
        if (path.dirname(oldPath) === path.dirname(newPath)) {
          // Renaming the entry
          nodeToAdd.name = path.basename(newPath);
        }
        nodeToAdd.relativePath = newFileNodeInfo.relativePath;

        if (fileRenamedAction === ActionResult.ActionPerformed) {
          nodeToAdd.status = ComparisonStatus.unchanged; // File saved remotely
        }
        if (fileRenamedAction === ActionResult.DontExist) {
          nodeToAdd.status = ComparisonStatus.added; // File doesn't exist remotely
        }
        if (fileRenamedAction === ActionResult.Exists) {
          nodeToAdd.status = ComparisonStatus.unchanged; // File exists remotely and are the same
        }
        if (fileRenamedAction === ActionResult.IsNotSame) {
          nodeToAdd.status = ComparisonStatus.modified; // File exists remotely and are not the same
        }

        const addedNode = await treeDataProvider.updateRootElements(
          action,
          nodeToAdd,
        );
        await treeDataProvider.refresh(addedNode);

        if (fileRenamedAction) {
          nodeToMove.status =
            nodeToMove.status !== ComparisonStatus.added
              ? ComparisonStatus.unchanged
              : ComparisonStatus.added;

          nodeToMove.relativePath = oldFileNodeInfo.relativePath;
          const deletedNode = await treeDataProvider.updateRootElements(
            Action.Remove,
            nodeToMove,
          );
          await treeDataProvider.refresh(deletedNode);

          if (path.dirname(oldPath) === path.dirname(newPath)) {
            // Renaming the entry
            nodeToMove.name = path.basename(newPath);
          }

          nodeToMove.relativePath = newFileNodeInfo.relativePath;
          const movedNode = await treeDataProvider.updateRootElements(
            Action.Add,
            nodeToMove,
          );
          await treeDataProvider.refresh(movedNode);
        } else {
          nodeToMove.status = ComparisonStatus.removed;
          nodeToMove.relativePath = oldFileNodeInfo.relativePath;
          const deletedNode = await treeDataProvider.updateRootElements(
            Action.Update,
            nodeToMove,
          );
          await treeDataProvider.refresh(deletedNode);

          const nodeToAdd = nodeToMove.clone();
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

  static async handleFileOpen(
    document: vscode.TextDocument,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    const filePath = document.uri.fsPath;

    if (!FileEventHandler.isFileInWorkspace(filePath)) {
      FileEventHandler.logFileNotInWorkspace(Action.Open, filePath);
      return;
    }

    if (FileEventHandler.isSettingsFile(Action.Open, filePath)) {
      return;
    }

    console.log(`<handleFileOpen> Event opening ${filePath}`);

    try {
      const openedNode = await JsonManager.findNodeByPath(
        filePath,
        treeDataProvider.rootElements,
      );
      if (!openedNode) {
        console.log(`<handleFileOpen> Node not found for ${filePath}`);
        return;
      }

      const fileDownloaded = await fileOpen(document.uri);
      if (fileDownloaded) {
        openedNode.status = ComparisonStatus.unchanged;
      }

      const savedNode = await treeDataProvider.updateRootElements(
        Action.Update,
        openedNode,
      );
      await treeDataProvider.refresh(savedNode);
    } catch (err: any) {
      console.error("<handleFileOpen> Error: ", err);
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
