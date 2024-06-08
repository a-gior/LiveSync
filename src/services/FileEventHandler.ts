import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import {
  FileEntry,
  FileEntryType,
  FileEntryStatus,
  FileEntrySource,
} from "../utilities/FileEntry";
import { PairedFoldersTreeDataProvider } from "./PairedFoldersTreeDataProvider";
import {
  getRelativePath,
  getRemotePath,
} from "../utilities/fileUtils/filePathUtils";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import {
  compareRemoteFileHash,
  uploadFile,
} from "../utilities/fileUtils/sftpOperations";
import { ConfigurationState } from "../DTOs/states/ConfigurationState";
import {
  fileDelete,
  fileMove,
  fileSave,
} from "../utilities/fileUtils/fileEventFunctions";

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
  static async handleFileCreate(
    event: vscode.FileCreateEvent,
    treeDataProvider: PairedFoldersTreeDataProvider,
  ) {
    console.log(`[handleFileCreate] DEBUG: File(s) created: `, event.files);
    for (const fileUri of event.files) {
      fileSave(fileUri)
        .then(() => {
          const newEntry = FileEntry.getEntryFromLocalPath(fileUri.fsPath);
          newEntry.updateStatus(FileEntryStatus.new);

          console.log(`[handleFileCreate] DEBUG: New entry: `, newEntry);
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
    console.log(`[handleFileDelete] DEBUG: File(s) deleted: `, event.files);
    for (const fileUri of event.files) {
      fileDelete(fileUri)
        .then(() => {
          const entryToRemove = treeDataProvider.findEntryByPath(
            fileUri.fsPath,
            FileEntrySource.local,
          );
          console.log(
            `[handleFileDelete] DEBUG: Entry to remove: `,
            fileUri.fsPath,
            entryToRemove,
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
    console.log(`[handleFileRename] DEBUG: File(s) renamed: `, event.files);
    for (const { oldUri, newUri } of event.files) {
      fileMove(oldUri, newUri)
        .then(() => {
          const entryToRenameOrMove = treeDataProvider.findEntryByPath(
            oldUri.fsPath,
            FileEntrySource.local,
          );
          console.log(
            `[handleFileRename] DEBUG: Entry to rename or move: `,
            entryToRenameOrMove,
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
              FileEntrySource.local,
            );
            treeDataProvider.removeElement(entryToRenameOrMove, oldParentEntry);

            const newParentEntry = treeDataProvider.findEntryByPath(
              path.dirname(newUri.fsPath),
              FileEntrySource.local,
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
    console.log(
      `[handleFileChange] DEBUG: Document changed: `,
      event.document.uri.fsPath,
    );
    // const changedFileUri = event.document.uri;
    // const changedEntry = treeDataProvider.findEntryByPath(changedFileUri.fsPath, FileEntrySource.local);
    // if (changedEntry) {
    //   // Perform necessary updates to the changedEntry
    //   treeDataProvider.refresh(changedEntry);
    // }
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
    await fileSave(document.uri)
      .then(() => {
        const entrySaved = treeDataProvider.findEntryByPath(
          document.uri.fsPath,
          FileEntrySource.local,
        );
        vscode.commands.executeCommand("livesync.fileEntryRefresh", entrySaved);
      })
      .catch((err: any) => {
        console.error("[handleFileSave] Error : ", err);
      });
  }
}
