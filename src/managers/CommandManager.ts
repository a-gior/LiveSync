import * as vscode from "vscode";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { LOG_FLAGS, logInfoMessage, LogManager } from "../managers/LogManager";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import {
  ComparisonFileNode,
  ComparisonStatus,
} from "../utilities/ComparisonFileNode";
import { Action } from "../utilities/enums";
import { showDiff } from "../utilities/fileUtils/fileDiff";
import {
  downloadDirectory,
  uploadDirectory,
} from "../utilities/fileUtils/directoryOperations";
import JsonManager, { JsonType } from "../managers/JsonManager";
import { ConnectionManager } from "./ConnectionManager";
import { SSHClient } from "../services/SSHClient";
import { WorkspaceConfigManager } from "./WorkspaceConfigManager";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { compareCorrespondingEntry } from "../utilities/fileUtils/entriesComparison";
import { FileEventHandler } from "../services/FileEventHandler";

export class CommandManager {
  private static runningCommands: Set<string> = new Set();

  /**
   * Ensures a command is executed only once at a time.
   */
  private static async singleExecution(
    commandKey: string,
    command: (...args: any[]) => Promise<boolean> | Promise<void> | void,
    args: any[],
  ) {
    if (this.runningCommands.has(commandKey)) {
      logInfoMessage(`Command "${commandKey}" is already running.`);
      return;
    }

    let returnResult;
    this.runningCommands.add(commandKey);

    try {
      returnResult = await command(...args);
    } catch (error: any) {
      logInfoMessage(
        `Error executing command "${commandKey}": ${error.message || error}`,
      );
      throw error;
    } finally {
      this.runningCommands.delete(commandKey);
      return returnResult;
    }
  }

  static registerCommands(
    context: vscode.ExtensionContext,
    treeDataProvider: SyncTreeDataProvider,
  ): void {
    // Define all command callbacks
    const commands: {
      [key: string]: (
        ...args: any[]
      ) => Promise<boolean> | Promise<void> | void;
    } = {
      "livesync.showLogs": () => {
        LogManager.showLogs();
      },

      "livesync.configuration": () => {
        ConfigurationPanel.render(context.extensionUri);
      },

      "livesync.refreshConfig": () => {
        ConfigurationPanel.kill();
        ConfigurationPanel.render(context.extensionUri);

        setTimeout(() => {
          vscode.commands.executeCommand(
            "workbench.action.webview.openDeveloperTools",
          );
        }, 500);
      },

      "livesync.refreshAll": async () => {
        const { localPath, remotePath } =
          WorkspaceConfigManager.getWorkspaceFullPaths();
        const comparisonFileNode = await treeDataProvider.getComparisonFileNode(
          localPath,
          remotePath,
        );
        const existingNode = treeDataProvider.rootElements.get(
          comparisonFileNode.name,
        );
        if (existingNode) {
          Object.assign(existingNode, comparisonFileNode); // Update properties while keeping the same reference
        }

        await JsonManager.getInstance().updateFullJson(
          JsonType.COMPARE,
          treeDataProvider.rootElements,
        );
        await treeDataProvider.refresh();
      },

      "livesync.refresh": async (element?: ComparisonFileNode) => {
        if (!element) {
          const { localPath, remotePath } =
            WorkspaceConfigManager.getWorkspaceFullPaths();
          const comparisonFileNode =
            await treeDataProvider.getComparisonFileNode(localPath, remotePath);

          // Update the root elements
          const rootNode = treeDataProvider.rootElements.get(
            comparisonFileNode.name,
          );
          if (rootNode) {
            Object.assign(rootNode, comparisonFileNode); // Update properties while keeping the same reference
          }

          await JsonManager.getInstance().updateFullJson(
            JsonType.COMPARE,
            treeDataProvider.rootElements,
          );
          await treeDataProvider.refresh();
        } else {
          const comparisonFileNode = await compareCorrespondingEntry(element);
          const updatedElement = await treeDataProvider.updateRootElements(
            Action.Update,
            comparisonFileNode,
          );

          await JsonManager.getInstance().updateFullJson(
            JsonType.COMPARE,
            treeDataProvider.rootElements,
          );
          await treeDataProvider.refresh(updatedElement);
        }
      },

      "livesync.fileEntryShowDiff": (input: ComparisonFileNode) => {
        showDiff(input);
      },

      "livesync.fileEntryUpload": async (
        comparisonNode: ComparisonFileNode,
      ) => {
        if (comparisonNode.isDirectory()) {
          await uploadDirectory(comparisonNode);

          ComparisonFileNode.setComparisonStatus(
            comparisonNode,
            ComparisonStatus.unchanged,
          );
          const updatedNode = await treeDataProvider.updateRootElements(
            Action.Update,
            comparisonNode,
          );
          await JsonManager.getInstance().updateFullJson(
            JsonType.COMPARE,
            treeDataProvider.rootElements,
          );
          await treeDataProvider.refresh(updatedNode);
        } else {
          await FileEventHandler.handleFileUpload(
            comparisonNode,
            treeDataProvider,
          );
        }
      },

      "livesync.fileEntryDownload": async (
        comparisonNode: ComparisonFileNode,
      ) => {
        if (comparisonNode.isDirectory()) {
          await downloadDirectory(comparisonNode);

          ComparisonFileNode.setComparisonStatus(
            comparisonNode,
            ComparisonStatus.unchanged,
          );
          const updatedNode = await treeDataProvider.updateRootElements(
            Action.Update,
            comparisonNode,
          );
          await JsonManager.getInstance().updateFullJson(
            JsonType.COMPARE,
            treeDataProvider.rootElements,
          );
          await treeDataProvider.refresh(updatedNode);
        } else {
          await FileEventHandler.handleFileDownload(
            comparisonNode,
            treeDataProvider,
          );
        }
      },

      "livesync.toggleToListView": () => {
        treeDataProvider.toggleViewMode(false);
        context.globalState.update("showAsTree", false);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncViewMode",
          "list",
        );
      },

      "livesync.toggleToTreeView": () => {
        treeDataProvider.toggleViewMode(true);
        context.globalState.update("showAsTree", true);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncViewMode",
          "tree",
        );
      },

      "livesync.showUnchanged": () => {
        treeDataProvider.setShowUnchanged(true);
        context.globalState.update("showUnchanged", true);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncShowUnchanged",
          true,
        );
      },

      "livesync.hideUnchanged": () => {
        treeDataProvider.setShowUnchanged(false);
        context.globalState.update("showUnchanged", false);
        vscode.commands.executeCommand(
          "setContext",
          "livesyncShowUnchanged",
          false,
        );
      },

      "livesync.collapseAll": async () => {
        const jsonManager = JsonManager.getInstance();
        await jsonManager.clearFoldersState();
        await vscode.commands.executeCommand("nodeDependencies.focus");
        await vscode.commands.executeCommand("list.collapseAll");
        logInfoMessage("All folders collapsed.");
      },

      "livesync.testConnection": async (
        configuration?: ConfigurationMessage["configuration"],
      ) => {
        if (!configuration) {
          configuration = WorkspaceConfigManager.getRemoteServerConfigured();
        }

        const connectionManager = ConnectionManager.getInstance(configuration);
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
    };

    // Register all commands with single execution logic
    for (const [commandId, callback] of Object.entries(commands)) {
      context.subscriptions.push(
        vscode.commands.registerCommand(commandId, (...args) =>
          this.singleExecution(commandId, callback, args),
        ),
      );
    }
  }
}
