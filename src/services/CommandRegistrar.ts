import * as vscode from "vscode";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { LOG_FLAGS, logErrorMessage, logInfoMessage, LogManager } from "../managers/LogManager";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";
import { ComparisonFileNode } from "../utilities/ComparisonFileNode";
import { Action } from "../utilities/enums";
import { showDiff } from "../utilities/fileUtils/fileDiff";
import { compareCorrespondingEntry } from "../utilities/fileUtils/entriesComparison";
import { handleAction, performDelete } from "../utilities/fileUtils/fileOperations";
import { Dialog } from "../services/Dialog";
import { FileNodeSource } from "../utilities/FileNode";
import { countLocalFiles, fetchRemoteCountOutput, parseRemoteItemCount, syncRemoteDeniedPaths } from "../utilities/fileUtils/fileListing";
import { getFullPaths, getRelativePath } from "../utilities/fileUtils/filePathUtils";
import { CommandEntry, CommandManager, ExecutionMode } from "../managers/CommandManager";
import { StatusBarManager } from "../managers/StatusBarManager";
import { configManager } from "../extension";
import { ConnectionSettings } from "../DTOs/config/ConnectionSettings";
import { suppressConfigError } from "../storage/ConfigErrorSuppressor";
import { WorkspaceConfig } from "./WorkspaceConfig";

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

            const folder =  await configManager!.pickTargetFolder(); // Returns single workspace or show popup to choose one and return it
            if (!folder) {
              // user hit “Cancel” – nothing to do
              return;
            }

            if (mode === 'ui') {
              ConfigurationPanel.show(context.extensionUri, folder);
            } else {
              configManager!.openJsonConfig(folder);
            }
          },
          mode: ExecutionMode.Single,
        },
        'livesync.refreshConfig': {
          callback: async () => {
            
            const folder =  await configManager!.pickTargetFolder(); // Returns single workspace or show popup to choose one and return it
            if (!folder) {
              // user hit “Cancel” – nothing to do
              return;
            }
            ConfigurationPanel.kill();
            ConfigurationPanel.show(context.extensionUri, folder);
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
            StatusBarManager.showMessage(`Scanning…`, "", "", 0, "sync~spin", true);
            
            const workspaceConfig = treeDataProvider.currentWorkspaceConfig;
            if(element instanceof vscode.Uri) {
              const relativePath = getRelativePath(element.fsPath, FileNodeSource.local);
              const comparisonNode = workspaceConfig.jsonStore.findComparisonNode(relativePath);
              element = comparisonNode;
            }

            // pick root vs subtree
            const { localPath, remotePath } = element ? await getFullPaths(element) : workspaceConfig.getPathPair();

            try {
              // init progress for both local & remote
              await this.initProgressFor(workspaceConfig, localPath, remotePath);

              // build or update the comparison node
              let compNode: ComparisonFileNode;
              if (element) {
                compNode = await compareCorrespondingEntry(element);
                const updated = await treeDataProvider.updateRootElements(Action.Update, compNode);
                await treeDataProvider.refresh(updated);
              } else {
                compNode = await treeDataProvider.getComparisonFileNode(localPath, remotePath);
                workspaceConfig.jsonStore.comparisonFileRoot = compNode;
                await treeDataProvider.refresh();
              }

              StatusBarManager.showMessage("Differences loaded", "", "", 5000, "check");
            } catch (err: any) {
              StatusBarManager.showMessage("Error while scanning", "", "", 5000, "error");
              logErrorMessage(err.message, LOG_FLAGS.ALL);
            }
          },
          mode: ExecutionMode.Single,
        },
        'livesync.showDiff': {
          callback: async (input: ComparisonFileNode | vscode.Uri) => {
            if(input instanceof vscode.Uri) {
              const workspaceConfig = treeDataProvider.currentWorkspaceConfig;
              const relativePath = getRelativePath(input.fsPath, FileNodeSource.local);
              const comparisonNode = workspaceConfig.jsonStore.findComparisonNode(relativePath);
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
          callback: async () => handleAction(treeDataProvider.displayedComparisonNode, 'upload', treeDataProvider),
          mode: ExecutionMode.Queue,
        },
        'livesync.downloadAll': {
          callback: async () => handleAction(treeDataProvider.displayedComparisonNode, 'download', treeDataProvider),
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
            treeDataProvider.toggleViewExpansion(true); // sets _collapseAll = true
              context.globalState.update("collapseAll", true);
              await vscode.commands.executeCommand("setContext", "livesyncExpandMode", "collapse");

              // optional: clear saved folder states to keep things tidy
              const wc = treeDataProvider.currentWorkspaceConfig;
              wc.jsonStore.clearFolderStates();

              // Optionally also collapse the VS Code list widget:
              await vscode.commands.executeCommand("treeViewId.focus");
              await vscode.commands.executeCommand("list.collapseAll");

              // Re-render once—no per-node reveals
              await treeDataProvider.refresh();
              logInfoMessage("All folders collapsed.");
          },
          mode: ExecutionMode.Single,
        },
        'livesync.expandChangedFolders': {
          callback: async () => {
            
            treeDataProvider.toggleViewExpansion(false); // sets _collapseAll = false
            context.globalState.update("collapseAll", false);
            await vscode.commands.executeCommand("setContext", "livesyncExpandMode", "expand");

            const wc = treeDataProvider.currentWorkspaceConfig;
            // Recompute which folders should be open (fills folderStates)
            await wc.jsonStore.expandChangedFoldersRecursive(wc.jsonStore.comparisonFileRoot);

            // Single refresh — VS Code opens those folders based on collapsibleState
            await treeDataProvider.refresh();

            logInfoMessage("All changed folders expanded.");
          },
          mode: ExecutionMode.Single,
        },
        'livesync.testConnection': {
          callback: async (configuration?: ConnectionSettings) => {
            const workspaceConfig = treeDataProvider.currentWorkspaceConfig;
            if (!configuration) {
              configuration = workspaceConfig.connectionSettings;
            }
    
            const connectionService = workspaceConfig.connectionService;
            try {
              await connectionService.withSSH(async () => {}, "Test Connection");
    
              return true;
            } catch (error: any) {
              return false;
            }
          },
          mode: ExecutionMode.Single,
        },
        'livesync.dismissConfigError': {
          callback: async (folder: vscode.WorkspaceFolder) => {
            await suppressConfigError(folder);
            logInfoMessage(
              `Configuration errors for "${folder.name}" will be suppressed until valid.`,
              LOG_FLAGS.ALL
            );
          },
          mode: ExecutionMode.Single,
        },
        'livesync.toggleRefreshOnConfigSave': {
          callback: async (uri?: vscode.Uri) => {
            const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
            if (!folder) {return;}

            const config = vscode.workspace.getConfiguration('livesync', folder.uri);
            const current = config.get<boolean>('refreshOnConfigSave', true);
            await config.update('refreshOnConfigSave', !current, vscode.ConfigurationTarget.WorkspaceFolder);

            vscode.window.showInformationMessage(
              `Refresh on config save: ${!current ? 'ON' : 'OFF'} for “${folder.name}”.`
            );
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

    private static async initProgressFor(workspaceConfig: WorkspaceConfig, localPath: string, remotePath: string) {
      const localCountP = countLocalFiles(localPath);
      const remoteCountP = workspaceConfig.connectionService.withSSH(
        ssh => fetchRemoteCountOutput(ssh, remotePath)
          .then(raw => { syncRemoteDeniedPaths(workspaceConfig, raw); return parseRemoteItemCount(raw); }),
        "Count remote files"
      );

      const [localCount, remoteCount] = await Promise.all([localCountP, remoteCountP]);
      StatusBarManager.initProgress(localCount + remoteCount);
    }
  }