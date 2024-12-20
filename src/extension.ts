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
import JsonManager from "./services/JsonManager";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  console.log(
    "Activating, show context.subscriptions: ",
    context.subscriptions,
  );

  // Retrieve stored values from the previous session
  const showAsTree = context.globalState.get<boolean>("showAsTree", true); // Default to true
  const showUnchanged = context.globalState.get<boolean>("showUnchanged", true); // Default to true

  const pairedFoldersTreeDataProvider = new PairedFoldersTreeDataProvider(
    showAsTree,
    showUnchanged,
  );
  await pairedFoldersTreeDataProvider.loadRootElements();

  // Create and register the TreeView
  const treeView = vscode.window.createTreeView("nodeDependencies", {
    treeDataProvider: pairedFoldersTreeDataProvider,
  });

  // Listen for expand and collapse events
  treeView.onDidExpandElement((event) => {
    const expandedElement = event.element;
    JsonManager.getInstance().updateFolderState(expandedElement, true);
  });

  treeView.onDidCollapseElement((event) => {
    const collapsedElement = event.element;
    JsonManager.getInstance().updateFolderState(collapsedElement, false);
  });

  // Create the permanent status bar icon
  StatusBarManager.createPermanentIcon();
  context.subscriptions.push(
    vscode.commands.registerCommand("livesync.showLogs", () => {
      LogManager.showLogs();
    }),
  );

  // Initialize the view mode context key
  vscode.commands.executeCommand(
    "setContext",
    "livesyncViewMode",
    showAsTree ? "tree" : "list",
  );
  vscode.commands.executeCommand(
    "setContext",
    "livesyncShowUnchanged",
    showUnchanged,
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
      (
        input: ComparisonFileNode | { localPath: string; remotePath: string },
      ) => {
        showDiff(input);
      },
    ),
    vscode.commands.registerCommand(
      "livesync.fileEntryUpload",
      async (comparisonNode: ComparisonFileNode) => {
        console.log("FileNode Upload: ", comparisonNode);
        if (comparisonNode.isDirectory()) {
          await uploadDirectory(comparisonNode);
        } else {
          try {
            const { localPath } = await getFullPaths(comparisonNode);
            console.log(`localPath: ${localPath}`);
            if (!localPath) {
              throw new Error(
                `No local path found for ${comparisonNode.relativePath}`,
              );
            }

            const fileUri = vscode.Uri.file(localPath);
            await fileUpload(fileUri);
          } catch (error: any) {
            logErrorMessage(`Failed to read file: ${error.message}`);
          }
        }
        await pairedFoldersTreeDataProvider.updateRootElements(
          Action.Update,
          comparisonNode,
        );
        vscode.commands.executeCommand(
          "livesync.fileEntryRefresh",
          comparisonNode,
        );
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
    vscode.commands.registerCommand("livesync.toggleToListView", () => {
      pairedFoldersTreeDataProvider.toggleViewMode(false);
      context.globalState.update("showAsTree", false); // Save the new state
      vscode.commands.executeCommand("setContext", "livesyncViewMode", "list");
    }),
    vscode.commands.registerCommand("livesync.toggleToTreeView", () => {
      pairedFoldersTreeDataProvider.toggleViewMode(true);
      context.globalState.update("showAsTree", true); // Save the new state
      vscode.commands.executeCommand("setContext", "livesyncViewMode", "tree");
    }),
    vscode.commands.registerCommand("livesync.showUnchanged", () => {
      pairedFoldersTreeDataProvider.setShowUnchanged(true);
      context.globalState.update("showUnchanged", true); // Save the new state
      vscode.commands.executeCommand(
        "setContext",
        "livesyncShowUnchanged",
        true,
      );
    }),
    vscode.commands.registerCommand("livesync.hideUnchanged", () => {
      pairedFoldersTreeDataProvider.setShowUnchanged(false);
      context.globalState.update("showUnchanged", false); // Save the new state
      vscode.commands.executeCommand(
        "setContext",
        "livesyncShowUnchanged",
        false,
      );
    }),
    vscode.commands.registerCommand("livesync.collapseAll", async () => {
      // Clear the folder state from JsonManager to reset all expanded folders
      const jsonManager = JsonManager.getInstance();
      await jsonManager.clearFoldersState();

      await vscode.commands.executeCommand("nodeDependencies.focus");
      await vscode.commands.executeCommand("list.collapseAll");
      logInfoMessage("All folders collapsed.");
    }),
  );

  // Register event handlers for file changes
  FileEventHandler.initialize(context, pairedFoldersTreeDataProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
