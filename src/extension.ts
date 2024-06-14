// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ConfigurationPanel } from "./panels/ConfigurationPanel";
import { PairedFoldersTreeDataProvider } from "./services/PairedFoldersTreeDataProvider";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import {
  FileEntry,
  FileEntrySource,
  FileEntryStatus,
} from "./utilities/FileEntry";
import { showDiff } from "./utilities/fileUtils/fileDiff";
import { fileSave } from "./utilities/fileUtils/fileEventFunctions";
import { handleFileDownload } from "./utilities/fileUtils/fileDownload";
import {
  downloadDirectory,
  uploadDirectory,
} from "./utilities/fileUtils/directoryOperations";
import { FileEventHandler } from "./services/FileEventHandler";
import path from "path";
import { StatusBarManager } from "./services/StatusBarManager";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log(
    "Activating, show context.subscriptions: ",
    context.subscriptions,
  );

  // Create the permanent status bar icon
  StatusBarManager.createPermanentIcon();

  // const rootPath =
  //   vscode.workspace.workspaceFolders &&
  //   vscode.workspace.workspaceFolders.length > 0
  //     ? vscode.workspace.workspaceFolders[0].uri.fsPath
  //     : undefined;

  console.log('Congratulations, your extension "livesync" is now active!');

  const pairedFoldersTreeDataProvider = new PairedFoldersTreeDataProvider();
  vscode.window.registerTreeDataProvider(
    "nodeDependencies",
    pairedFoldersTreeDataProvider,
  );
  const fileStatusDecorationProvider = new FileStatusDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider),
  );

  let refreshDisposable = vscode.commands.registerCommand(
    "livesync.refreshConfig",
    () => {
      ConfigurationPanel.kill();
      ConfigurationPanel.render(context.extensionUri);

      setTimeout(async () => {
        await vscode.commands.executeCommand(
          "workbench.action.webview.openDeveloperTools",
        );
      }, 500);
    },
  );
  context.subscriptions.push(refreshDisposable);

  let configurationDisposable = vscode.commands.registerCommand(
    "livesync.configuration",
    () => {
      // Check if there are any workspace folders open
      if (vscode.workspace.workspaceFolders === undefined) {
        vscode.window.showErrorMessage(
          "No workspace opened. This extension requires an open workspace.",
        );
        return;
      }

      ConfigurationPanel.render(context.extensionUri);
    },
  );
  context.subscriptions.push(configurationDisposable);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "livesync.fileEntryRefresh",
      (element?: FileEntry) => {
        console.log(`[Refresh command] element: `, element);
        if (!element) {
          pairedFoldersTreeDataProvider.refresh();
        } else {
          if (element.status === FileEntryStatus.new) {
            element.status = FileEntryStatus.added;
            const parentEntry = pairedFoldersTreeDataProvider.findEntryByPath(
              path.dirname(element.fullPath),
              FileEntrySource.local,
            );
            pairedFoldersTreeDataProvider.addElement(element, parentEntry);
          } else if (element.status === FileEntryStatus.deleted) {
            const parentEntry = pairedFoldersTreeDataProvider.findEntryByPath(
              path.dirname(element.fullPath),
              FileEntrySource.local,
            );
            element.status = FileEntryStatus.removed;
            pairedFoldersTreeDataProvider.removeElement(element, parentEntry);
          } else {
            FileEntry.compareSingleEntry(element).then(
              (updatedElement: FileEntry) => {
                console.log(
                  `[Refresh command] updatedElement: `,
                  updatedElement,
                );
                pairedFoldersTreeDataProvider.refresh(updatedElement);
              },
            );
          }
        }
      },
    ),
    vscode.commands.registerCommand(
      "livesync.fileEntryShowDiff",
      (fileEntry: FileEntry) => {
        showDiff(fileEntry);
      },
    ),
    vscode.commands.registerCommand(
      "livesync.fileEntryUpload",
      async (fileEntry: FileEntry) => {
        if (fileEntry.isDirectory()) {
          await uploadDirectory(fileEntry);
        } else {
          const document = await vscode.workspace.openTextDocument(
            fileEntry.fullPath,
          );
          await fileSave(document.uri);
        }
        vscode.commands.executeCommand("livesync.fileEntryRefresh", fileEntry);
      },
    ),
    vscode.commands.registerCommand(
      "livesync.fileEntryDownload",
      async (fileEntry) => {
        if (fileEntry.isDirectory()) {
          await downloadDirectory(fileEntry);
        } else {
          await handleFileDownload(fileEntry);
        }
        vscode.commands.executeCommand("livesync.fileEntryRefresh", fileEntry);
      },
    ),
  );

  // Register event handlers for file changes
  FileEventHandler.initialize(context, pairedFoldersTreeDataProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
