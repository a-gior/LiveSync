import * as vscode from "vscode";
import { getFullPaths } from "../utilities/fileUtils/filePathUtils";
import { listLocalFiles, listRemoteFiles } from "../utilities/fileUtils/fileListing";
import { IconLoader } from "./IconLoader";
import { ComparisonFileNode, ComparisonStatus } from "../utilities/ComparisonFileNode";
import { BaseNodeType } from "../utilities/BaseNode";
import { LOG_FLAGS, logInfoMessage } from "../managers/LogManager";
import path from "path";
import { Action } from "../utilities/enums";
import { TreeViewManager } from "../managers/TreeViewManager";
import { StatusBarManager } from "../managers/StatusBarManager";
import { configManager } from "../extension";
import { FileNodeSource } from "../utilities/FileNode";
import { handleConfigError, WorkspaceConfigError } from "../managers/WorkspaceConfigManager";

export class SyncTreeDataProvider implements vscode.TreeDataProvider<ComparisonFileNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<ComparisonFileNode | undefined | void> = new vscode.EventEmitter<
    ComparisonFileNode | undefined | void
  >();
  readonly onDidChangeTreeData: vscode.Event<ComparisonFileNode | undefined | void> = this._onDidChangeTreeData.event;

  private _showUnchanged: boolean;
  private _showAsTree: boolean;
  private _collapseAll: boolean;

  private _currentWorkspace: vscode.WorkspaceFolder;

  public displayedComparisonNode?: ComparisonFileNode;

  constructor(folder: vscode.WorkspaceFolder, showAsTree: boolean = true, showUnchanged: boolean = true, collapseAll: boolean = true) {
    this._showAsTree = showAsTree;
    this._showUnchanged = showUnchanged;
    this._collapseAll = collapseAll;

    this._currentWorkspace = folder;
  }

  updateDisplayedComparisonNode() {
    this.displayedComparisonNode = this.currentWorkspaceConfig.jsonStore.comparisonFileRoot;
  }

  public get settings() {
    return {
      showAsTree: this._showAsTree,
      showUnchanged: this._showUnchanged,
      collapseAll: this._collapseAll
    };
  }

  public get currentWorkspace() {
    return this._currentWorkspace;
  }
  
  public set currentWorkspace(folder: vscode.WorkspaceFolder) {
    this._currentWorkspace = folder;
  }

  public get currentWorkspaceConfig() {
    return configManager!.getConfig(this._currentWorkspace.uri);
  }

  toggleViewMode(showAsTree: boolean): void {
    this._showAsTree = showAsTree;
    this.refresh();
  }

  setShowUnchanged(showUnchanged: boolean): void {
    this._showUnchanged = showUnchanged;
    this.refresh();
  }

  toggleViewExpansion(collapseAll: boolean): void {
    this._collapseAll = collapseAll;
    this.refresh();
  }

  async refresh(element?: ComparisonFileNode): Promise<void> {
    TreeViewManager.updateMessage(this);
    logInfoMessage("Refreshing Tree: ", LOG_FLAGS.CONSOLE_ONLY, element);
  
    // Skip refresh if element belongs to a different workspace
    if(element && element.workspaceFolder.uri.fsPath !== this._currentWorkspace.uri.fsPath) {
      return;
    }

    if (!this._showAsTree || !element || element.relativePath === "" || element.relativePath === ".") {
      this._onDidChangeTreeData.fire(undefined);
      return;
    }
  
    if (!element.isDirectory()) {
      const parentRel = path.dirname(element.relativePath);
      const parentNode = this.currentWorkspaceConfig.jsonStore.findComparisonNode(parentRel);
      this._onDidChangeTreeData.fire(parentNode);
      return;
    } 
  
    this._onDidChangeTreeData.fire(element);
    
  }

  async getTreeItem(element: ComparisonFileNode): Promise<vscode.TreeItem> {
    const foldersStateElement = this.currentWorkspaceConfig.jsonStore.folderStates;
    const isOpened = element.relativePath in foldersStateElement; // Check for relativePath key in folders state

    let label: string;
    if (element.relativePath === "" || this._showAsTree) {
      label = element.name;
    } else {
      label = element.relativePath;
    }

    let collapsibleState: vscode.TreeItemCollapsibleState;
    if (element.type === BaseNodeType.directory && (this._showAsTree || element.relativePath === "")) {
      collapsibleState = isOpened ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    const treeItem = new vscode.TreeItem(label, collapsibleState);

    if (element.status && element.type) {
      treeItem.iconPath =
        element.type === BaseNodeType.directory ? IconLoader.getFolderIcon(element.name) : IconLoader.getFileIcon(element.name);
      treeItem.contextValue = `fileEntry-${element.type}-${element.status}`;
      treeItem.description = ComparisonStatus[element.status];
      const query = `?status=${ComparisonStatus[element.status]}`;
      treeItem.resourceUri = vscode.Uri.file(element.relativePath).with({
        query
      });
    }

    // Attach command only to files
    if (element.type === BaseNodeType.file && element.status !== ComparisonStatus.removed) {
      let { localPath } = await getFullPaths(element);
      treeItem.command = {
        command: 'livesync.openFile',
        title: 'Open File',
        arguments: [localPath]
      };
    }

    return treeItem;
  }

  async getChildren(element?: ComparisonFileNode): Promise<ComparisonFileNode[]> {
    // If we’re expanding an existing node, just return its children
    if (element) {
      return this.applyViewMode(Array.from(element.children.values()));
    }

    if(!this.currentWorkspaceConfig.isValid) {
      handleConfigError(new WorkspaceConfigError(this.currentWorkspace, "Invalid Config"), this.currentWorkspace);
      return [];
    }

    // Ensure we have a comparisonFileRoot in our store
    const store = this.currentWorkspaceConfig.jsonStore;
    let root;
    try {
      // JSON comparison data found
      root = store.comparisonFileRoot;
    } catch(err: any) {
      // JSON comparison data not found
      const { localPath, remotePath } = this.currentWorkspaceConfig.getPathPair();
      root = await this.getComparisonFileNode(localPath, remotePath);
      store.comparisonFileRoot = root;
    }
    this.updateDisplayedComparisonNode();

    // Return the top-level children
    return this.applyViewMode(Array.from(root.children.values()));
  }

  getParent(element: ComparisonFileNode): vscode.ProviderResult<ComparisonFileNode> {
    if (!element.relativePath || element.relativePath === "") {
      // Root nodes do not have a parent
      return null;
    }

    const parentPath = path.dirname(element.relativePath);
    return this.currentWorkspaceConfig.jsonStore.findComparisonNode(parentPath);
  }

  // Get the whole ComparisonFileNode of the whole tree
  async getComparisonFileNode(localDir: string, remoteDir: string): Promise<ComparisonFileNode> {
    try {
      const localFiles = await listLocalFiles(localDir);
      const remoteFiles = await listRemoteFiles(remoteDir);

      
      const comparisonFileNode = ComparisonFileNode.compareFileNodes(localFiles, remoteFiles, this.displayedComparisonNode);

      if (remoteFiles) {
        this.currentWorkspaceConfig.jsonStore.updateRemote(remoteFiles);
      }

      StatusBarManager.showMessage("Differences loaded", "", "", 5000, "check");
      return comparisonFileNode;
    } catch (error: any) {
      StatusBarManager.showMessage("Error while comparing files", "", "", 5000, "error");
      throw error;
    }
  }

  async updateRootElements(
    action: Action,
    element: ComparisonFileNode
  ): Promise<ComparisonFileNode> {
    const {localPath} = await getFullPaths(element);
    const workspaceConfig = configManager!.getWorkspaceFolderFromPath(localPath, FileNodeSource.local);
    const store = configManager!.getConfig(workspaceConfig.uri).jsonStore;

    switch (action) {
      case Action.Add:
      case Action.Update:
        // Add and Update both just patch in the new subtree
        await store.updateComparison(element);
        break;

      case Action.Remove:
        // Remove that branch entirely
        await store.removeComparisonSubtree(element.relativePath);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    this.updateDisplayedComparisonNode();

    return element.updateParentDirectoriesStatus();
  }

  private applyViewMode(nodes: ComparisonFileNode[]): ComparisonFileNode[] {
    const viewNodes: ComparisonFileNode[] = [];

    const recurse = (currentNodes: ComparisonFileNode[], parentNode?: ComparisonFileNode) => {
      for (const node of currentNodes) {
        // Handle root node specifically in flatten mode
        if (!this._showAsTree && node.relativePath === "") {
          // Create a new root node that will be shown in flatten mode
          const rootNodeCopy = new ComparisonFileNode(node.name, node.workspaceFolder, node.type, node.size, node.modifiedTime, node.relativePath, node.status);

          // Add the root node itself to viewNodes
          viewNodes.push(rootNodeCopy);

          // Add its children in a flattened manner to the root node's children
          if (node.children && node.children.size > 0) {
            recurse(Array.from(node.children.values()), rootNodeCopy);
          }
          continue; // Skip the usual handling since we have handled the root node separately
        }

        // Set visibility of nodes based on _showUnchanged setting, always show the root folder
        if (this._showUnchanged || node.status !== ComparisonStatus.unchanged) {
          node.showInTree = true; // Show the node
        } else {
          node.showInTree = false; // Hide the node
        }

        // Only proceed with visible nodes
        if (node.showInTree) {
          if (this._showAsTree) {
            // When in tree mode, maintain hierarchy
            if (!parentNode) {
              viewNodes.push(node);
            } else {
              parentNode.children.set(node.name, node);
            }

            // If the node has children, recurse with its children
            if (node.children && node.children.size > 0) {
              recurse(Array.from(node.children.values()), node);
            }
          } else {
            // In flat mode, add the node directly
            if (parentNode) {
              // Add as a child of rootNodeCopy
              parentNode.children.set(node.name, node);
            } else {
              // Add to viewNodes (only files or added/removed directories)
              if (
                (node.isDirectory() && (node.status === ComparisonStatus.added || node.status === ComparisonStatus.removed)) ||
                !node.isDirectory()
              ) {
                viewNodes.push(node);
              }
            }

            // If the node has children, recurse to flatten
            if (node.children && node.children.size > 0) {
              recurse(Array.from(node.children.values()), parentNode);
            }
          }
        }
      }
    };

    // Start recursion
    recurse(nodes);

    // Sort the view nodes after processing
    this.sortViewNodes(viewNodes);
    return viewNodes;
  }

  private sortViewNodes(nodes: ComparisonFileNode[]): void {
    // directories first, then files, alphabetically
    nodes.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  
    // if you’re in tree-mode, recurse into each folder’s children
    if (this._showAsTree) {
      for (const n of nodes) {
        if (n.children && n.children.size) {
          this.sortViewNodes(Array.from(n.children.values()));
        }
      }
    }
  }
}
