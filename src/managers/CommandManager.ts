import * as vscode from "vscode";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { LOG_FLAGS, logInfoMessage, LogManager } from "../managers/LogManager";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import { ComparisonFileNode } from "../utilities/ComparisonFileNode";
import { Action } from "../utilities/enums";
import { showDiff } from "../utilities/fileUtils/fileDiff";
import { fileUpload } from "../utilities/fileUtils/fileEventFunctions";
import { handleFileDownload } from "../utilities/fileUtils/fileDownload";
import {
  downloadDirectory,
  uploadDirectory,
} from "../utilities/fileUtils/directoryOperations";
import JsonManager from "../managers/JsonManager";
import { getFullPaths } from "../utilities/fileUtils/filePathUtils";
import { ConnectionManager } from "./ConnectionManager";
import { SSHClient } from "../services/SSHClient";
import { WorkspaceConfigManager } from "./WorkspaceConfigManager";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { compareCorrespondingEntry } from "../utilities/fileUtils/entriesComparison";

export class CommandManager {
  static registerCommands(
    context: vscode.ExtensionContext,
    treeDataProvider: SyncTreeDataProvider,
  ): void {
    context.subscriptions.push(
      // Show logs
      vscode.commands.registerCommand("livesync.showLogs", () => {
        LogManager.showLogs();
      }),

      // Configuration panel
      vscode.commands.registerCommand("livesync.configuration", () => {
        ConfigurationPanel.render(context.extensionUri);
      }),

      // Refresh configuration
      vscode.commands.registerCommand("livesync.refreshConfig", () => {
        ConfigurationPanel.kill();
        ConfigurationPanel.render(context.extensionUri);

        setTimeout(() => {
          vscode.commands.executeCommand(
            "workbench.action.webview.openDeveloperTools",
          );
        }, 500);
      }),

      // Refresh all
      vscode.commands.registerCommand("livesync.refreshAll", async () => {
        const { localPath, remotePath } =
          WorkspaceConfigManager.getWorkspaceFullPaths();
        const comparisonFileNode = await treeDataProvider.getComparisonFileNode(
          localPath,
          remotePath,
        );
        treeDataProvider.rootElements.set(
          comparisonFileNode.name,
          comparisonFileNode,
        );

        await treeDataProvider.refresh();
      }),

      // File entry refresh
      vscode.commands.registerCommand(
        "livesync.refresh",
        async (element?: ComparisonFileNode) => {
          console.log("element", element);
          if (!element) {
            const { localPath, remotePath } =
              WorkspaceConfigManager.getWorkspaceFullPaths();
            const comparisonFileNode =
              await treeDataProvider.getComparisonFileNode(
                localPath,
                remotePath,
              );
            treeDataProvider.rootElements.set(
              comparisonFileNode.name,
              comparisonFileNode,
            );

            await treeDataProvider.refresh();
          } else {
            const comparisonFileNode = await compareCorrespondingEntry(element);
            const updatedElement = await treeDataProvider.updateRootElements(
              Action.Update,
              comparisonFileNode,
            );

            await treeDataProvider.refresh(updatedElement);
          }
        },
      ),

      // Show file diff
      vscode.commands.registerCommand(
        "livesync.fileEntryShowDiff",
        (input: ComparisonFileNode) => {
          showDiff(input);
        },
      ),

      // File upload
      vscode.commands.registerCommand(
        "livesync.fileEntryUpload",
        async (comparisonNode: ComparisonFileNode) => {
          if (comparisonNode.isDirectory()) {
            await uploadDirectory(comparisonNode);
          } else {
            const { localPath } = await getFullPaths(comparisonNode);
            const fileUri = vscode.Uri.file(localPath);
            await fileUpload(fileUri);
          }
          await treeDataProvider.refresh(comparisonNode);
        },
      ),

      // File download
      vscode.commands.registerCommand(
        "livesync.fileEntryDownload",
        async (fileEntry: ComparisonFileNode) => {
          if (fileEntry.isDirectory()) {
            await downloadDirectory(fileEntry);
          } else {
            await handleFileDownload(fileEntry);
          }
          await treeDataProvider.refresh(fileEntry);
        },
      ),

      // Toggle to list view
      vscode.commands.registerCommand("livesync.toggleToListView", () => {
        treeDataProvider.toggleViewMode(false);
        context.globalState.update("showAsTree", false);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncViewMode",
          "list",
        );
      }),

      // Toggle to tree view
      vscode.commands.registerCommand("livesync.toggleToTreeView", () => {
        treeDataProvider.toggleViewMode(true);
        context.globalState.update("showAsTree", true);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncViewMode",
          "tree",
        );
      }),

      // Show unchanged files
      vscode.commands.registerCommand("livesync.showUnchanged", () => {
        treeDataProvider.setShowUnchanged(true);
        context.globalState.update("showUnchanged", true);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncShowUnchanged",
          true,
        );
      }),

      // Hide unchanged files
      vscode.commands.registerCommand("livesync.hideUnchanged", () => {
        treeDataProvider.setShowUnchanged(false);
        context.globalState.update("showUnchanged", false);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncShowUnchanged",
          false,
        );
      }),

      // Collapse all folders
      vscode.commands.registerCommand("livesync.collapseAll", async () => {
        const jsonManager = JsonManager.getInstance();
        await jsonManager.clearFoldersState();
        await vscode.commands.executeCommand("nodeDependencies.focus");
        await vscode.commands.executeCommand("list.collapseAll");
        logInfoMessage("All folders collapsed.");
      }),

      // Test connection
      vscode.commands.registerCommand(
        "livesync.testConnection",
        async (configuration?: ConfigurationMessage["configuration"]) => {
          if (!configuration) {
            configuration = WorkspaceConfigManager.getRemoteServerConfigured();
          }

          const connectionManager =
            ConnectionManager.getInstance(configuration);
          try {
            await connectionManager.doSSHOperation(
              async (sshClient: SSHClient) => {
                await sshClient.waitForConnection();
              },
              "Test Connection",
            );

            logInfoMessage("Test connection successful.", LOG_FLAGS.ALL);
            return true;
          } catch (error: any) {
            return false;
          }
        },
      ),
    );
  }
}
