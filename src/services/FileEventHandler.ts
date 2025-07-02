import * as vscode from "vscode";
import * as path from "path";
import { FileNode } from "../utilities/FileNode";
import { SyncTreeDataProvider } from "./SyncTreeDataProvider";

import {
  fileCreate,
  fileDelete,
  fileDownload,
  fileMove,
  fileOpen,
  fileSave,
  fileUpload
} from "../utilities/fileUtils/fileEventFunctions";
import { ComparisonFileNode, ComparisonStatus } from "../utilities/ComparisonFileNode";
import JsonManager from "../managers/JsonManager";
import { Action, ActionResult } from "../utilities/enums";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "../managers/LogManager";
import { getFullPaths, getRelativePath } from "../utilities/fileUtils/filePathUtils";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";
import { CommandManager } from "../managers/CommandManager";

export class FileEventHandler {
  
  static enableFileCreate = true;
  static enableFileDelete = true;
  static enableFileRename = true;
  static enableFileSave = true;
  static enableFileOpen = true;

  /**
   * Initialize file event handlers and register them in the extension context.
   * @param context - The extension context
   * @param treeDataProvider - The tree data provider
   */
  static initialize(
    context: vscode.ExtensionContext,
    treeDataProvider: SyncTreeDataProvider
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidCreateFiles(event => {
        if (!FileEventHandler.enableFileCreate) {return;}
        CommandManager.queueExecution(
          'onDidCreateFiles',
          FileEventHandler.handleFileCreate,
          [event, treeDataProvider]
        );
      }),
  
      vscode.workspace.onDidDeleteFiles(event => {
        if (!FileEventHandler.enableFileDelete) {return;}
        CommandManager.queueExecution(
          'onDidDeleteFiles',
          FileEventHandler.handleFileDelete,
          [event, treeDataProvider]
        );
      }),
  
      vscode.workspace.onDidRenameFiles(event => {
        if (!FileEventHandler.enableFileRename) {return;}
        CommandManager.queueExecution(
          'onDidRenameFiles',
          FileEventHandler.handleFileRename,
          [event, treeDataProvider]
        );
      }),
  
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor || !FileEventHandler.enableFileOpen) {return;}
        CommandManager.queueExecution(
          'onDidChangeActiveTextEditor',
          FileEventHandler.handleFileOpen,
          [editor.document, treeDataProvider]
        );
      }),
  
      vscode.workspace.onDidSaveTextDocument(document => {
        if (!FileEventHandler.enableFileSave) {return;}
        CommandManager.queueExecution(
          'onDidSaveTextDocument',
          FileEventHandler.handleFileSave,
          [document, treeDataProvider]
        );
      }),
  
      vscode.workspace.onDidChangeConfiguration(() => {
        CommandManager.queueExecution(
          'onDidChangeConfiguration',
          async () => {
            if (WorkspaceConfigManager.isVscodeSettingsValid) {
              WorkspaceConfigManager.reload();
            }
          },
          []
        );
      })
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
    return workspaceFolders.some((folder) => filePath.startsWith(folder.uri.fsPath));
  }

  /**
   * Logs a message indicating that the file is not in the workspace.
   * @param action - The action that was attempted (e.g., "creating", "deleting", "saving")
   * @param filePath - The file path
   */
  static logFileNotInWorkspace(action: string, filePath: string): void {
    logInfoMessage(`<handleFile${action}> Event ${action} ${filePath} not in workspace, we do nothing`);
  }

  static isSettingsFile(action: string, filePath: string): boolean {
    // Get the workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders) {
      // Iterate over all workspace folders and check for the settings file path
      for (const workspaceFolder of workspaceFolders) {
        const settingsPath = path.join(workspaceFolder.uri.fsPath, ".vscode", "settings.json");
        if (filePath === settingsPath) {
          if (action === Action.Save) {
            logInfoMessage(`<handleFile${action}> Detected configuration file at ${filePath}, reloading workspace configuration.`);
            WorkspaceConfigManager.reload();
          } else {
            logInfoMessage(`<handleFile${action}> Detected configuration file at ${filePath}, skipping further processing of this event.`);
          }
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
  static async handleFileCreate(event: vscode.FileCreateEvent, treeDataProvider: SyncTreeDataProvider) {
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
          console.warn(`<handleFileCreate> File node for ${filePath} could not be created`);
          continue;
        }

        // Build comparison file node to add to rootElements
        const comparisonNode = new ComparisonFileNode(
          fileNode.name,
          fileNode.type,
          fileNode.size,
          fileNode.modifiedTime,
          fileNode.relativePath
        );

        // Action done or files have similar hashes
        if (fileCreatedAction === ActionResult.ActionPerformed || fileCreatedAction === ActionResult.Exists) {
          // File created on remote
          comparisonNode.setStatus(ComparisonStatus.unchanged);
        } else if (fileCreatedAction === ActionResult.IsNotSame) {
          // File exists remotely and is different
          comparisonNode.setStatus(ComparisonStatus.modified);
        } else {
          // File only local or doesn't exist remotely
          comparisonNode.setStatus(ComparisonStatus.added);
        }

        // Update rootElements and refresh the tree
        const updatedNode = await treeDataProvider.updateRootElements(Action.Add, comparisonNode);
        await treeDataProvider.refresh(updatedNode);
      } catch (err: any) {
        logErrorMessage("<handleFileCreate> Error: ", LOG_FLAGS.CONSOLE_ONLY, err);
      }
    }
  }

  /**
   * Handle file delete events.
   * @param event - The file delete event
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileDelete(event: vscode.FileDeleteEvent, treeDataProvider: SyncTreeDataProvider) {
    for (const fileUri of event.files) {
      const filePath = fileUri.fsPath;

      if (!FileEventHandler.isFileInWorkspace(filePath)) {
        FileEventHandler.logFileNotInWorkspace("Delete", filePath);
        continue;
      }

      if (FileEventHandler.isSettingsFile(Action.Remove, filePath)) {
        continue;
      }

      logInfoMessage(`<handleFileDelete> Event deleting ${filePath}`);

      try {
        // Get node from rootElements
        const nodeToDelete = await JsonManager.findNodeByPath(filePath, treeDataProvider.rootElements);
        if (!nodeToDelete) {
          console.warn(`<handleFileDelete> Node not found for ${filePath}`);
          return;
        }

        // Delete file remotely depending on ActionOnDelete parameter
        const fileDeletedAction = await fileDelete(fileUri);

        // Status becomes removed if remote file isn't deleted
        if (fileDeletedAction !== ActionResult.ActionPerformed) {
          nodeToDelete.setStatus(ComparisonStatus.removed);
        }

        // Remove node from rootElements if also removed remotely, update it otherwise and refresh the tree view
        const action = fileDeletedAction === ActionResult.ActionPerformed ? Action.Remove : Action.Update;
        const deletedNode = await treeDataProvider.updateRootElements(action, nodeToDelete);
        await treeDataProvider.refresh(deletedNode);
      } catch (err: any) {
        logErrorMessage("<handleFileDelete> Error: ", LOG_FLAGS.CONSOLE_ONLY, err);
      }
    }
  }

  /**
   * Handle file save events.
   * @param document - The text document
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileSave(document: vscode.TextDocument, treeDataProvider: SyncTreeDataProvider) {
    const filePath = document.uri.fsPath;

    if (!FileEventHandler.isFileInWorkspace(filePath)) {
      FileEventHandler.logFileNotInWorkspace("Save", filePath);
      return;
    }

    if (FileEventHandler.isSettingsFile(Action.Save, filePath)) {
      return;
    }

    logInfoMessage(`<handleFileSave> Event saving ${filePath}`);

    try {
      // Get node from rootElements
      const nodeToSave = await JsonManager.findNodeByPath(filePath, treeDataProvider.rootElements);
      if (!nodeToSave) {
        console.warn(`<handleFileSave> Node not found for ${filePath}`);
        return;
      }

      // Save file remotely depending on ActionOnSave parameter
      const fileSavedAction = await fileSave(document.uri);

      if (fileSavedAction === ActionResult.ActionPerformed) {
        nodeToSave.setStatus(ComparisonStatus.unchanged); // File saved remotely
      }
      if (fileSavedAction === ActionResult.DontExist) {
        nodeToSave.setStatus(ComparisonStatus.added); // File doesn't exist remotely
      }
      if (fileSavedAction === ActionResult.Exists) {
        nodeToSave.setStatus(ComparisonStatus.unchanged); // File exists remotely and are the same
      }
      if (fileSavedAction === ActionResult.IsNotSame) {
        nodeToSave.setStatus(ComparisonStatus.modified); // File exists remotely and are not the same
      }

      // Update node in rootElements and refresh the tree view
      const savedNode = await treeDataProvider.updateRootElements(Action.Update, nodeToSave);
      await treeDataProvider.refresh(savedNode);
    } catch (err: any) {
      logErrorMessage("<handleFileSave> Error: ", LOG_FLAGS.CONSOLE_ONLY, err);
    }
  }

  /**
   * Handle file rename events.
   * @param event - The file rename event
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileRename(event: vscode.FileRenameEvent, treeDataProvider: SyncTreeDataProvider) {
    for (const { oldUri, newUri } of event.files) {
      const oldPath = oldUri.fsPath;
      const newPath = newUri.fsPath;
      // Check if the file is being renamed within the same directory
      const newName = path.dirname(oldPath) === path.dirname(newPath) ? path.basename(newPath) : null;

      if (!FileEventHandler.isFileInWorkspace(oldPath) || !FileEventHandler.isFileInWorkspace(newPath)) {
        FileEventHandler.logFileNotInWorkspace("Rename", oldPath);
        continue;
      }

      if (FileEventHandler.isSettingsFile(Action.Move, oldPath) || FileEventHandler.isSettingsFile(Action.Move, newPath)) {
        return;
      }

      logInfoMessage(`<handleFileRename> Event renaming/moving from ${oldPath} to ${newPath}`);

      try {
        // Get node from rootElements
        const nodeToMove = await JsonManager.findNodeByPath(oldPath, treeDataProvider.rootElements);
        if (!nodeToMove) {
          logErrorMessage(`<handleFileRename> Node not found for ${oldPath}`);
          continue;
        }

        const fileMoveAction = await fileMove(oldUri, newUri);

        nodeToMove.name = newName || nodeToMove.name; // Update name if renaming within the same directory

        if (fileMoveAction === ActionResult.ActionPerformed) {
          nodeToMove.setStatus(ComparisonStatus.unchanged); // File/Folder saved remotely
        }
        if (fileMoveAction === ActionResult.DontExist) {
          nodeToMove.setStatus(ComparisonStatus.added); // File/Folder doesn't exist remotely
        }
        if (fileMoveAction === ActionResult.Exists) {
          nodeToMove.setStatus(ComparisonStatus.unchanged); // File/Folder exists remotely and are the same
        }
        if (fileMoveAction === ActionResult.IsNotSame) {
          nodeToMove.setStatus(ComparisonStatus.modified); // File/Folder exists remotely and are not the same
        }
  
        // Update node in rootElements and refresh the tree view
        const action = newName ? Action.Update : Action.Remove;
        const movedNode = await treeDataProvider.updateRootElements(action, nodeToMove);
        await treeDataProvider.refresh(movedNode);

        if(!newName) {
          const nodeToAdd = nodeToMove.clone();
          const newFileNodeRelativePath = getRelativePath(newPath);
          nodeToAdd.relativePath = newFileNodeRelativePath;
          const addedNode = await treeDataProvider.updateRootElements(Action.Add, nodeToAdd);
          await treeDataProvider.refresh(addedNode);
        }
        
      } catch (err: any) {
        logErrorMessage("<handleFileRename> Error: ", LOG_FLAGS.CONSOLE_ONLY, err);
      }
    }
  }

  static async handleFileOpen(document: vscode.TextDocument, treeDataProvider: SyncTreeDataProvider) {
    const filePath = document.uri.fsPath;

    if (!FileEventHandler.isFileInWorkspace(filePath)) {
      FileEventHandler.logFileNotInWorkspace(Action.Open, filePath);
      return;
    }

    if (FileEventHandler.isSettingsFile(Action.Open, filePath)) {
      return;
    }

    logInfoMessage(`<handleFileOpen> Event opening ${filePath}`);

    try {
      const openedNode = await JsonManager.findNodeByPath(filePath, treeDataProvider.rootElements);
      if (!openedNode) {
        logInfoMessage(`<handleFileOpen> Node not found for ${filePath}`);
        return;
      }

      const fileDownloaded = await fileOpen(document.uri);

      if (fileDownloaded === ActionResult.ActionPerformed) {
        openedNode.setStatus(ComparisonStatus.unchanged); // File saved remotely
      }
      if (fileDownloaded === ActionResult.DontExist) {
        openedNode.setStatus(ComparisonStatus.added); // File doesn't exist remotely
      }
      if (fileDownloaded === ActionResult.Exists) {
        openedNode.setStatus(ComparisonStatus.unchanged); // File exists remotely and are the same
      }
      if (fileDownloaded === ActionResult.IsNotSame) {
        openedNode.setStatus(ComparisonStatus.modified); // File exists remotely and are not the same
      }

      const savedNode = await treeDataProvider.updateRootElements(Action.Update, openedNode);
      await treeDataProvider.refresh(savedNode);
    } catch (err: any) {
      logErrorMessage("<handleFileOpen> Error: ", LOG_FLAGS.CONSOLE_ONLY, err);
    }
  }

  /**
   * Handle file download.
   * @param fileNode - The file node to download
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileDownload(fileNode: ComparisonFileNode, treeDataProvider: SyncTreeDataProvider) {
    const { localPath, remotePath } = await getFullPaths(fileNode);

    if (!FileEventHandler.isFileInWorkspace(localPath)) {
      FileEventHandler.logFileNotInWorkspace("Download", localPath);
      return;
    }

    logInfoMessage(`<handleFileDownload> Downloading file from ${remotePath} to ${localPath}`);

    try {
      const uri = vscode.Uri.file(localPath);
      const downloadResult = await fileDownload(uri);

      if (downloadResult === ActionResult.ActionPerformed) {
        fileNode.setStatus(ComparisonStatus.unchanged); // File downloaded successfully
      } else if (downloadResult === ActionResult.Exists) {
        fileNode.setStatus(ComparisonStatus.unchanged); // File already exists and is the same
      } else if (downloadResult === ActionResult.IsNotSame) {
        fileNode.setStatus(ComparisonStatus.modified); // File exists locally but is different
      }

      const updatedNode = await treeDataProvider.updateRootElements(Action.Update, fileNode);
      await treeDataProvider.refresh(updatedNode);
    } catch (err: any) {
      logErrorMessage("<handleFileDownload> Error: ", LOG_FLAGS.CONSOLE_ONLY, err);
    }
  }

  /**
   * Handle file upload.
   * @param fileNode - The file node to upload
   * @param treeDataProvider - The tree data provider
   */
  static async handleFileUpload(fileNode: ComparisonFileNode, treeDataProvider: SyncTreeDataProvider) {
    const { localPath, remotePath } = await getFullPaths(fileNode);

    if (!FileEventHandler.isFileInWorkspace(localPath)) {
      FileEventHandler.logFileNotInWorkspace("Upload", localPath);
      return;
    }

    logInfoMessage(`<handleFileUpload> Uploading file from ${localPath} to ${remotePath}`);

    try {
      const uri = vscode.Uri.file(localPath);
      const uploadResult = await fileUpload(uri);

      if (uploadResult === ActionResult.ActionPerformed) {
        fileNode.setStatus(ComparisonStatus.unchanged); // File uploaded successfully
      } else if (uploadResult === ActionResult.Exists) {
        fileNode.setStatus(ComparisonStatus.unchanged); // File already exists and is the same
      } else if (uploadResult === ActionResult.IsNotSame) {
        fileNode.setStatus(ComparisonStatus.modified); // File exists remotely but is different
      }

      const updatedNode = await treeDataProvider.updateRootElements(Action.Update, fileNode);
      await treeDataProvider.refresh(updatedNode);
    } catch (err: any) {
      logErrorMessage("<handleFileUpload> Error: ", LOG_FLAGS.CONSOLE_ONLY, err);
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
