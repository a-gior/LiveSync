import * as vscode from "vscode";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { LOG_FLAGS, logErrorMessage, logInfoMessage, LogManager } from "../managers/LogManager";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import { ComparisonFileNode } from "../utilities/ComparisonFileNode";
import { Action } from "../utilities/enums";
import { showDiff } from "../utilities/fileUtils/fileDiff";
import JsonManager, { JsonType } from "../managers/JsonManager";
import { ConnectionManager } from "./ConnectionManager";
import { SSHClient } from "../services/SSHClient";
import { WorkspaceConfigManager } from "./WorkspaceConfigManager";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { compareCorrespondingEntry } from "../utilities/fileUtils/entriesComparison";
import { getRootElement, handleAction, performDelete } from "../utilities/fileUtils/fileOperations";
import { Dialog } from "../services/Dialog";
import { FileNodeSource } from "../utilities/FileNode";
import { TreeViewManager } from "./TreeViewManager";
import { StatusBarManager } from "./StatusBarManager";
import {
  listLocalFiles,
  listRemoteFiles
} from "../utilities/fileUtils/fileListing";

export class CommandManager {
  private static runningCommands: Set<string> = new Set();

  /**
   * Ensures a command is executed only once at a time.
   */
  private static async singleExecution(
    commandKey: string,
    command: (...args: any[]) => Promise<boolean> | Promise<void> | void,
    args: any[]
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
      logInfoMessage(`Error executing command "${commandKey}": ${error.message}`);
      throw error;
    } finally {
      this.runningCommands.delete(commandKey);
      return returnResult;
    }
  }

  static registerCommands(context: vscode.ExtensionContext, treeDataProvider: SyncTreeDataProvider): void {
    // Define all command callbacks
    const commands: {
      [key: string]: (...args: any[]) => Promise<boolean> | Promise<void> | void;
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
          vscode.commands.executeCommand("workbench.action.webview.openDeveloperTools");
        }, 500);
      },

      "livesync.refreshAll": async () => {
        WorkspaceConfigManager.reload();
        const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();
    
        // ───────────────────────────────────────────────────────────────────────────
        // 1) TIME the NEW optimized approach
        // ───────────────────────────────────────────────────────────────────────────
        let comparisonNode: ComparisonFileNode | null = null;
        let durationMs = 0;
    
        try {
          const t0 = performance.now();
    
          // 1.a) List local files (optimized)
          const localRoot = await listLocalFiles(localPath);
          // 1.b) List remote files (optimized)
          const remoteRoot = await listRemoteFiles(remotePath);
    
          if (!localRoot || !remoteRoot) {
            throw new Error("Listing returned undefined");
          }
    
          // 1.c) Compare the two trees
          comparisonNode = ComparisonFileNode.compareFileNodes(localRoot, remoteRoot);
    
          const t1 = performance.now();
          durationMs = t1 - t0;
          logInfoMessage(`Listing + compare (optimized): ${durationMs.toFixed(2)} ms`);
          StatusBarManager.showMessage("Comparing done!", "", "", 3000, "check");
        } catch (err: any) {
          logErrorMessage(
            `<refreshAll> Optimized listing+compare failed: ${err.message}`,
            LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
            err
          );
          StatusBarManager.showMessage("Refresh All failed", "", "", 3000, "error");
          return;
        }
    
        // ───────────────────────────────────────────────────────────────────────────
        // 2) Update the tree with the comparison result
        // ───────────────────────────────────────────────────────────────────────────
        if (!comparisonNode) {
          StatusBarManager.showMessage("Refresh All failed: no comparison result", "", "", 3000, "error");
          return;
        }
    
        const existingNode = treeDataProvider.rootElements.get(comparisonNode.name);
        if (existingNode) {
          // Update properties in-place
          Object.assign(existingNode, comparisonNode);
        } else {
          // Insert new root-level node
          treeDataProvider.rootElements.set(comparisonNode.name, comparisonNode);
        }
    
        // Persist the comparison JSON
        await JsonManager.getInstance().updateFullJson(JsonType.COMPARE, treeDataProvider.rootElements);
    
        // Finally refresh the view
        await treeDataProvider.refresh();
      },

      "livesync.refresh": async (element?: ComparisonFileNode | vscode.Uri) => {
        if (!element) {
          const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();
          const comparisonFileNode = await treeDataProvider.getComparisonFileNode(localPath, remotePath);

          // Update the root elements
          const rootNode = treeDataProvider.rootElements.get(comparisonFileNode.name);
          if (rootNode) {
            Object.assign(rootNode, comparisonFileNode); // Update properties while keeping the same reference
          }

          await JsonManager.getInstance().updateFullJson(JsonType.COMPARE, treeDataProvider.rootElements);
          await treeDataProvider.refresh();
        } else {
          if (element instanceof vscode.Uri) {
            const comparisonNode = await JsonManager.findComparisonNodeFromUri(element, treeDataProvider);
            element = comparisonNode;
          }

          const comparisonFileNode = await compareCorrespondingEntry(element);
          StatusBarManager.showMessage("Comparing done!", "", "", 3000, "check");
          const updatedElement = await treeDataProvider.updateRootElements(Action.Update, comparisonFileNode);

          await treeDataProvider.refresh(updatedElement);
        }
      },

      "livesync.showDiff": async (input: ComparisonFileNode | vscode.Uri) => {
        if (input instanceof vscode.Uri) {
          const comparisonNode = await JsonManager.findComparisonNodeFromUri(input, treeDataProvider);
          input = comparisonNode;
        }

        showDiff(input);
      },

      "livesync.upload": async (element) => await handleAction(element, "upload", treeDataProvider),
      "livesync.download": async (element) => await handleAction(element, "download", treeDataProvider),
      "livesync.uploadAll": async () => await handleAction( getRootElement(treeDataProvider), "upload", treeDataProvider),
      "livesync.downloadAll": async () => await handleAction( getRootElement(treeDataProvider), "download", treeDataProvider),

      'livesync.openFile': (filePath: string) => {
        console.log("Opening file:", filePath);
        const uri = vscode.Uri.file(filePath);
        vscode.window.showTextDocument(uri, { preview: true });
      },

      "livesync.deleteLocalFile": async (node: ComparisonFileNode) => {
        const ok = await Dialog.confirmDelete(FileNodeSource.local, node.relativePath);
        if (!ok) {return;}
        try {
          await performDelete(node, treeDataProvider);
        } catch (e: any) {
          logErrorMessage(`Failed to delete local file: ${e.message}`);
        }
      },

      "livesync.deleteRemoteFile": async (node: ComparisonFileNode) => {
        const ok = await Dialog.confirmDelete(FileNodeSource.remote, node.relativePath);
        if (!ok) {return;}
        try {
          await performDelete(node, treeDataProvider);
        } catch (e: any) {
          logErrorMessage(`Failed to delete remote file: ${e.message}`);
        }
      },

      "livesync.toggleToListView": () => {
        treeDataProvider.toggleViewMode(false);
        context.globalState.update("showAsTree", false);
        vscode.commands.executeCommand("setContext", "livesyncViewMode", "list");
      },

      "livesync.toggleToTreeView": () => {
        treeDataProvider.toggleViewMode(true);
        context.globalState.update("showAsTree", true);
        vscode.commands.executeCommand("setContext", "livesyncViewMode", "tree");
      },

      "livesync.showUnchanged": () => {
        treeDataProvider.setShowUnchanged(true);
        context.globalState.update("showUnchanged", true);
        vscode.commands.executeCommand("setContext", "livesyncShowUnchanged", true);
      },

      "livesync.hideUnchanged": () => {
        treeDataProvider.setShowUnchanged(false);
        context.globalState.update("showUnchanged", false);
        vscode.commands.executeCommand("setContext", "livesyncShowUnchanged", false);
      },

      "livesync.collapseAll": async () => {
        
        treeDataProvider.toggleViewExpansion(true);
        context.globalState.update("collapseAll", true);
        vscode.commands.executeCommand("setContext", "livesyncExpandMode", "collapse");

        const jsonManager = JsonManager.getInstance();
        await jsonManager.clearFoldersState();
        await vscode.commands.executeCommand("treeViewId.focus");
        await vscode.commands.executeCommand("list.collapseAll");
        logInfoMessage("All folders collapsed.");
      },

      'livesync.expandChangedFolders': async () => {
        
        treeDataProvider.toggleViewExpansion(false);
        context.globalState.update("collapseAll", false);
        vscode.commands.executeCommand("setContext", "livesyncExpandMode", "expand");

        // Recompute which folders should be open
        const jsonManager = JsonManager.getInstance();
        await jsonManager.expandChangedFoldersRecursive(treeDataProvider);  // repopulates foldersState
        const rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();

        // 2) then actually reveal each "opened" folder
        const openedKeys = (await jsonManager.getFoldersState()).keys();
        for (const key of openedKeys) {
          // key === `${workspaceName}$$${relativePath}`
          const [, relPath] = key.split('$$');
          const node = await JsonManager.findNodeByPath(relPath, treeDataProvider.rootElements, rootFolderName);
          if (node && relPath !== ".") {
            // reveal with expand: true forces the UI to open it
            await TreeViewManager.treeView.reveal(node, { expand: true, focus: false, select: false });
          }
        }

        logInfoMessage("All changed folders expanded.");
      },

      "livesync.testConnection": async (configuration?: ConfigurationMessage["configuration"]) => {
        if (!configuration) {
          configuration = WorkspaceConfigManager.getRemoteServerConfigured();
        }

        const connectionManager = await ConnectionManager.getInstance(configuration);
        try {
          await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
            await sshClient.waitForConnection();
          }, "Test Connection");

          return true;
        } catch (error: any) {
          return false;
        }
      },

      'livesync.dismissConfigError': () => {
        // Set a global‐state flag so we won’t show the error again until cleared
        context.globalState.update('suppressConfigError', true);
        logInfoMessage( 'Configuration errors will be suppressed until the settings.json becomes valid again.', LOG_FLAGS.ALL);
      }
    };

    // Register all commands with single execution logic
    for (const [commandId, callback] of Object.entries(commands)) {
      context.subscriptions.push(vscode.commands.registerCommand(commandId, (...args) => this.singleExecution(commandId, callback, args)));
    }
  }
}
