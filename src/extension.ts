// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ConfigurationPanel } from "./panels/ConfigurationPanel";
import { PairedFoldersTreeDataProvider } from "./services/PairedFoldersTreeDataProvider";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import { showDiff } from "./utilities/fileUtils/fileDiff";
import { fileUpload } from "./utilities/fileUtils/fileEventFunctions";
import { handleFileDownload } from "./utilities/fileUtils/fileDownload";
import {
  downloadDirectory,
  uploadDirectory,
} from "./utilities/fileUtils/directoryOperations";
import { FileEventHandler } from "./services/FileEventHandler";
import { StatusBarManager } from "./services/StatusBarManager";
import { compareCorrespondingEntry } from "./utilities/fileUtils/entriesComparison";
import {
  LOG_FLAGS,
  logErrorMessage,
  logInfoMessage,
  LogManager,
} from "./services/LogManager";
import { ComparisonFileNode } from "./utilities/ComparisonFileNode";
import { getFullPaths } from "./utilities/fileUtils/filePathUtils";
import { Action } from "./utilities/enums";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  console.log(
    "Activating, show context.subscriptions: ",
    context.subscriptions,
  );

  const pairedFoldersTreeDataProvider = new PairedFoldersTreeDataProvider();
  await pairedFoldersTreeDataProvider.loadRootElements();

  // Create the permanent status bar icon
  StatusBarManager.createPermanentIcon();
  context.subscriptions.push(
    vscode.commands.registerCommand("livesync.showLogs", () => {
      LogManager.showLogs();
    }),
  );

  // const rootPath =
  //   vscode.workspace.workspaceFolders &&
  //   vscode.workspace.workspaceFolders.length > 0
  //     ? vscode.workspace.workspaceFolders[0].uri.fsPath
  //     : undefined;

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
      async (element?: ComparisonFileNode) => {
        if (!element) {
          logInfoMessage(
            "[Refresh command] all:",
            LOG_FLAGS.CONSOLE_ONLY,
            element,
          );
          pairedFoldersTreeDataProvider.refresh();
        } else {
          compareCorrespondingEntry(element).then(
            async (updatedElement: ComparisonFileNode) => {
              logInfoMessage(
                `[Refresh command] updatedElement: `,
                LOG_FLAGS.CONSOLE_ONLY,
                updatedElement,
              );
              await pairedFoldersTreeDataProvider
                .updateRootElements(Action.Update, updatedElement)
                .then();
              pairedFoldersTreeDataProvider.refresh(updatedElement);
            },
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "livesync.fileEntryShowDiff",
      (fileEntry: ComparisonFileNode) => {
        showDiff(fileEntry);
      },
    ),
    vscode.commands.registerCommand(
      "livesync.fileEntryUpload",
      async (fileEntry: ComparisonFileNode) => {
        console.log("FileNode Upload: ", fileEntry);
        if (fileEntry.isDirectory()) {
          await uploadDirectory(fileEntry);
        } else {
          try {
            const { localPath } = await getFullPaths(fileEntry);
            console.log(`localPath: ${localPath}`);
            if (!localPath) {
              throw new Error(
                `No local path found for ${fileEntry.relativePath}`,
              );
            }

            const fileUri = vscode.Uri.file(localPath);
            await fileUpload(fileUri, pairedFoldersTreeDataProvider);
          } catch (error: any) {
            logErrorMessage(`Failed to read file: ${error.message}`);
          }
        }
        await pairedFoldersTreeDataProvider.updateRootElements(
          Action.Update,
          fileEntry,
        );
        vscode.commands.executeCommand("livesync.fileEntryRefresh", fileEntry);
      },
    ),
    vscode.commands.registerCommand(
      "livesync.fileEntryDownload",
      async (fileEntry: ComparisonFileNode) => {
        try {
          if (fileEntry.isDirectory()) {
            await downloadDirectory(fileEntry);
          } else {
            await handleFileDownload(fileEntry);
          }
        } catch (error: any) {
          const errorMessage = `Failed to read file: ${error.message}`;
          const errorStack = error.stack ? `\nStack Trace: ${error.stack}` : "";
          logErrorMessage(`${errorMessage}${errorStack}`);
        }
        await pairedFoldersTreeDataProvider.updateRootElements(
          Action.Update,
          fileEntry,
        );
        vscode.commands.executeCommand("livesync.fileEntryRefresh", fileEntry);
      },
    ),
  );

  // Register event handlers for file changes
  FileEventHandler.initialize(context, pairedFoldersTreeDataProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
