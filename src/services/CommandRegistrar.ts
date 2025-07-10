import * as vscode from "vscode";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { LOG_FLAGS, logErrorMessage, logInfoMessage, LogManager } from "../managers/LogManager";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import { ComparisonFileNode } from "../utilities/ComparisonFileNode";
import { Action } from "../utilities/enums";
import { showDiff } from "../utilities/fileUtils/fileDiff";
import JsonManager, { JsonType } from "../managers/JsonManager";
import { SSHClient } from "../services/SSHClient";
import { compareCorrespondingEntry } from "../utilities/fileUtils/entriesComparison";
import { getRootElement, handleAction, performDelete } from "../utilities/fileUtils/fileOperations";
import { Dialog } from "../services/Dialog";
import { FileNodeSource } from "../utilities/FileNode";
import { countLocalFiles, fetchRemoteCountOutput, parseRemoteItemCount, syncRemoteDeniedPaths } from "../utilities/fileUtils/fileListing";
import { getFullPaths } from "../utilities/fileUtils/filePathUtils";
import { CommandEntry, CommandManager, ExecutionMode } from "../managers/CommandManager";
import { StatusBarManager } from "../managers/StatusBarManager";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";
import { ConnectionManager } from "../managers/ConnectionManager";
import { TreeViewManager } from "../managers/TreeViewManager";
import { WorkspaceConfigManager2 } from "../managers/WorkspaceConfigManager2";
import { configManager } from "../extension";

export class CommandRegistrar {
    static register(
      context: vscode.ExtensionContext,
      treeDataProvider: SyncTreeDataProvider
    ) {
      const commands: Record<string, CommandEntry> = {
        'livesync.showLogs': {
          callback: () => LogManager.showLogs(),
          mode: ExecutionMode.Single,
        },
        'livesync.configuration': {
          callback: async () => {
            let mode = vscode.workspace
              .getConfiguration('livesync')
              .get<'prompt'|'ui'|'json'>('openMode', 'prompt');

            if (mode === 'prompt') {
              const items = [
                { label: '$(gear) UI Panel', id: 'ui' as const },
                { label: '$(file-code) JSON',    id: 'json' as const }
              ];
              const choice = await vscode.window.showQuickPick(items, {
                placeHolder: 'Edit via UI or JSON?'
              });
              if (!choice) {
                // user hit “Cancel” – nothing to do
                return;
              }

              mode = choice.id;  // choice.id is now typed 'ui'|'json'
            }

            const folder =  await configManager?.pickTargetFolder(); // Returns single workspace or show popup to choose one and return it
            if (!folder) {
              // user hit “Cancel” – nothing to do
              return;
            }

            if (mode === 'ui') {
              ConfigurationPanel.show(context.extensionUri, folder);
            } else {
              configManager?.openJsonConfig(folder);
            }
          },
          mode: ExecutionMode.Single,
        },
        'livesync.refreshConfig': {
          callback: () => {
            ConfigurationPanel.kill();
            ConfigurationPanel.show(context.extensionUri);
            setTimeout(
              () => vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools'),
              500
            );
          },
          mode: ExecutionMode.Single,
        },
        'livesync.refreshAll': {
          callback: async () => await vscode.commands.executeCommand('livesync.refresh'),
          mode: ExecutionMode.Single,
        },
        'livesync.refresh': {
          callback: async (element?: ComparisonFileNode | vscode.Uri) => {
            WorkspaceConfigManager.reload();
  
            StatusBarManager.showMessage(`Scanning...`, "", "", 0, "sync~spin", true);
            try {
  
              if (!element) {
                // Get the number of files and folders to process and init progress bar
                const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();
                const totalLocalFiles = await countLocalFiles(localPath);
                
                const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
                const connectionManager = await ConnectionManager.getInstance(configuration);
                let totalRemoteFiles = 0;
                await connectionManager.doSSHOperation(
                  async (sshClient) => {
                    
                    const raw = await fetchRemoteCountOutput(sshClient, remotePath);
                    totalRemoteFiles = parseRemoteItemCount(raw);
                    await syncRemoteDeniedPaths(raw);
                  }
                ), "Count remote files";
  
                StatusBarManager.initProgress(totalLocalFiles+totalRemoteFiles);
      
                // Update the root elements
                const comparisonFileNode = await treeDataProvider.getComparisonFileNode(localPath, remotePath);
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
  
                const { localPath, remotePath } = await getFullPaths(element);
                const totalLocalFiles = await countLocalFiles(localPath);
                
                const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
                const connectionManager = await ConnectionManager.getInstance(configuration);
                let totalRemoteFiles = 0;
                await connectionManager.doSSHOperation(
                  async (sshClient) => {
                    
                    const raw = await fetchRemoteCountOutput(sshClient, remotePath);
                    totalRemoteFiles = parseRemoteItemCount(raw);
                    await syncRemoteDeniedPaths(raw);
                  }
                ), "Count remote files";
  
                StatusBarManager.initProgress(totalLocalFiles+totalRemoteFiles);
      
                const comparisonFileNode = await compareCorrespondingEntry(element);
                const updatedElement = await treeDataProvider.updateRootElements(Action.Update, comparisonFileNode);
      
                await treeDataProvider.refresh(updatedElement);
              }
              
              StatusBarManager.showMessage("Differences loaded", "", "", 5000, "check");
              
            } catch (error: any) {
              StatusBarManager.showMessage("Error while scanning", "", "", 5000, "error");
              logErrorMessage(error.message, LOG_FLAGS.ALL);
            }
          },
          mode: ExecutionMode.Single,
        },
        'livesync.showDiff': {
          callback: async (input: ComparisonFileNode | vscode.Uri) => {
            if (input instanceof vscode.Uri) {
              const comparisonNode = await JsonManager.findComparisonNodeFromUri(input, treeDataProvider);
              input = comparisonNode;
            }
    
            showDiff(input);
          },
          mode: ExecutionMode.Single,
        },
        'livesync.upload': {
          callback: async (element) => handleAction(element, 'upload', treeDataProvider),
          mode: ExecutionMode.Queue,
        },
        'livesync.download': {
          callback: async (element) => handleAction(element, 'download', treeDataProvider),
          mode: ExecutionMode.Queue,
        },
        'livesync.uploadAll': {
          callback: async () => handleAction(getRootElement(treeDataProvider), 'upload', treeDataProvider),
          mode: ExecutionMode.Queue,
        },
        'livesync.downloadAll': {
          callback: async () => handleAction(getRootElement(treeDataProvider), 'download', treeDataProvider),
          mode: ExecutionMode.Queue,
        },
        'livesync.openFile': {
          callback: (filePath: string) => {
            const uri = vscode.Uri.file(filePath);
            vscode.window.showTextDocument(uri, { preview: true });
          },
          mode: ExecutionMode.Queue,
        },
        'livesync.deleteLocal': {
          callback: async (node) => {
            if (!(await Dialog.confirmDelete(FileNodeSource.local, node.relativePath, node.isDirectory()))) {return;}

            await performDelete(node, treeDataProvider);
          },
          mode: ExecutionMode.Queue,
        },
        'livesync.deleteRemote': {
          callback: async (node) => {
            if (!(await Dialog.confirmDelete(FileNodeSource.remote, node.relativePath, node.isDirectory()))) {return;}

            await performDelete(node, treeDataProvider);
            
          },
          mode: ExecutionMode.Queue,
        },
        'livesync.toggleToListView': {
          callback: () => {
            treeDataProvider.toggleViewMode(false);
            context.globalState.update('showAsTree', false);
            vscode.commands.executeCommand('setContext', 'livesyncViewMode', 'list');
          },
          mode: ExecutionMode.Single,
        },
        'livesync.toggleToTreeView': {
          callback: () => {
            treeDataProvider.toggleViewMode(true);
            context.globalState.update("showAsTree", true);
            vscode.commands.executeCommand("setContext", "livesyncViewMode", "tree");
          },
          mode: ExecutionMode.Single,
        },
        'livesync.showUnchanged': {
          callback: () => {
            treeDataProvider.setShowUnchanged(true);
            context.globalState.update("showUnchanged", true);
            vscode.commands.executeCommand("setContext", "livesyncShowUnchanged", true);
          },
          mode: ExecutionMode.Single,
        },
        'livesync.hideUnchanged': {
          callback: () => {
            treeDataProvider.setShowUnchanged(false);
            context.globalState.update("showUnchanged", false);
            vscode.commands.executeCommand("setContext", "livesyncShowUnchanged", false);
          },
          mode: ExecutionMode.Single,
        },
        'livesync.collapseAll': {
          callback: async () => {
            treeDataProvider.toggleViewExpansion(true);
            context.globalState.update("collapseAll", true);
            vscode.commands.executeCommand("setContext", "livesyncExpandMode", "collapse");
    
            const jsonManager = JsonManager.getInstance();
            await jsonManager.clearFoldersState();
            await vscode.commands.executeCommand("treeViewId.focus");
            await vscode.commands.executeCommand("list.collapseAll");
            logInfoMessage("All folders collapsed.");
          },
          mode: ExecutionMode.Single,
        },
        // ...etc. for all your toggle/collapse/expand/testConnection/dismiss commands...
        'livesync.expandChangedFolders': {
          callback: async () => {
            
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
          mode: ExecutionMode.Single,
        },
        'livesync.testConnection': {
          callback: async (configuration?) => {
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
          mode: ExecutionMode.Single,
        },
        'livesync.dismissConfigError': {
          callback: () => {
            context.globalState.update('suppressConfigError', true);
            logInfoMessage( 'Configuration errors will be suppressed until the settings.json becomes valid again.', LOG_FLAGS.ALL);
          },
          mode: ExecutionMode.Single,
        },
      };
  
      for (const [id, entry] of Object.entries(commands)) {
        const wrapper = (...args: any[]) => {
          return entry.mode === ExecutionMode.Queue
            ? CommandManager.queueExecution(id, entry.callback, args)
            : CommandManager.singleExecution(id, entry.callback, args);
        };
        context.subscriptions.push(vscode.commands.registerCommand(id, wrapper));
      }
    }
  }