import * as vscode from "vscode";
import { ensureDirectoryExists } from "../utilities/fileUtils/fileOperations";
import { getFullPaths } from "../utilities/fileUtils/filePathUtils";
import { listLocalFiles, listRemoteFiles } from "../utilities/fileUtils/fileListing";
import { IconLoader } from "./IconLoader";
import { SAVE_DIR } from "../utilities/constants";
import JsonManager, { isComparisonFileNodeMap, JsonType } from "../managers/JsonManager";
import { ComparisonFileNode, ComparisonStatus } from "../utilities/ComparisonFileNode";
import { BaseNode, BaseNodeType } from "../utilities/BaseNode";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "../managers/LogManager";
import { StatusBarManager } from "../managers/StatusBarManager";
import { FileNode } from "../utilities/FileNode";
import path from "path";
import { Action } from "../utilities/enums";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";
import { TreeViewManager } from "../managers/TreeViewManager";

export class SyncTreeDataProvider implements vscode.TreeDataProvider<ComparisonFileNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<ComparisonFileNode | undefined | void> = new vscode.EventEmitter<
    ComparisonFileNode | undefined | void
  >();
  readonly onDidChangeTreeData: vscode.Event<ComparisonFileNode | undefined | void> = this._onDidChangeTreeData.event;

  private _showUnchanged: boolean;
  private _showAsTree: boolean;
  private _collapseAll: boolean;

  public rootElements: Map<string, ComparisonFileNode> = new Map<string, ComparisonFileNode>();
  private jsonManager: JsonManager;

  constructor(showAsTree: boolean = true, showUnchanged: boolean = true, collapseAll: boolean = true) {
    this._showAsTree = showAsTree;
    this._showUnchanged = showUnchanged;
    this._collapseAll = collapseAll;
    this.jsonManager = JsonManager.getInstance();
  }

  public get settings() {
    return {
      showAsTree: this._showAsTree,
      showUnchanged: this._showUnchanged,
      collapseAll: this._collapseAll
    };
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


  async loadRootElements(): Promise<void> {
    // Simulate async loading of root elements (e.g., from a JSON file)
    const comparisonEntries = await this.jsonManager.getFileEntriesMap(JsonType.COMPARE);

    if (comparisonEntries && isComparisonFileNodeMap(comparisonEntries)) {
      this.rootElements = comparisonEntries;
    }
  }

  async refresh(element?: ComparisonFileNode): Promise<void> {
    logInfoMessage("Refreshing Tree: ", LOG_FLAGS.CONSOLE_ONLY, element);
    TreeViewManager.updateMessage(this);
  
    const rootName = WorkspaceConfigManager.getWorkspaceBasename();
  
    // 1) Lst mode OR No element OR root element => full refresh
    if (!this._showAsTree || !element || element.relativePath === "" || element.relativePath === ".") {
      this._onDidChangeTreeData.fire(undefined);
      return;
    }
  
    // 2) File => refresh its parent folder (dirname "foo.ts" → "" → root)
    if (!element.isDirectory()) {
      const parentRel = path.dirname(element.relativePath);
      
      if(parentRel !== ".") {
        const parentNode = await JsonManager.findNodeByPath(
          parentRel,
          this.rootElements,
          rootName
        );
        this._onDidChangeTreeData.fire(parentNode);
      } else {
        this._onDidChangeTreeData.fire();
      }
      return;
    }
  
    // 3) Directory => refresh that directory node
    this._onDidChangeTreeData.fire(element);
    
  }

  async getTreeItem(element: ComparisonFileNode): Promise<vscode.TreeItem> {
    const isOpened = (await this.jsonManager.getFoldersState()).has(JsonManager.getMapKey(element));

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
    if(!WorkspaceConfigManager.isVSCodeConfigValid()) {
      return [];
    }
    
    if (!element) {
      try {
        const comparisonEntries = await this.jsonManager.getFileEntriesMap(JsonType.COMPARE);

        if (!comparisonEntries || comparisonEntries.size === 0) {
          ensureDirectoryExists(SAVE_DIR);
          const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();

          const comparisonFileNode = await this.getComparisonFileNode(localPath, remotePath);

          if (this.rootElements.has(comparisonFileNode.name)) {
            // Update the root elements
            const rootNode = this.rootElements.get(comparisonFileNode.name);
            if (rootNode) {
              Object.assign(rootNode, comparisonFileNode); // Update properties while keeping the same reference
            }
          } else {
            this.rootElements.set(comparisonFileNode.name, comparisonFileNode);
          }

          await this.jsonManager.updateFullJson(JsonType.COMPARE, this.rootElements);

          const rootTree = this.rootElements.get(comparisonFileNode.name);
          const rootNodes = BaseNode.toArray(rootTree!.children);
          return this.applyViewMode(rootNodes);
        } else if (comparisonEntries && isComparisonFileNodeMap(comparisonEntries)) {
          const rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
          this.rootElements = comparisonEntries;
          const rootTree = this.rootElements.get(rootFolderName);
          const rootNodes = BaseNode.toArray(rootTree!.children);
          return this.applyViewMode(rootNodes);
        } else {
          throw Error("Comparison JSON data not found. Please run the initial comparison.");
        }
      } catch (error: any) {
        logErrorMessage(`Error fetching comparison data: ${error.message}`, LOG_FLAGS.CONSOLE_ONLY);
        return [];
      }
    } else {
      const childrenArray = Array.from(element.children.values());
      return this.applyViewMode(childrenArray);
    }
  }

  getParent(element: ComparisonFileNode): vscode.ProviderResult<ComparisonFileNode> {
    if (!element.relativePath || element.relativePath === "") {
      // Root nodes do not have a parent
      return null;
    }

    const parentPath = path.dirname(element.relativePath);
    let rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
    return JsonManager.findNodeByPath(parentPath, this.rootElements, rootFolderName);
  }

  // Get the whole ComparisonFileNode of the whole tree
  async getComparisonFileNode(localDir: string, remoteDir: string): Promise<ComparisonFileNode> {
    const startTime = performance.now(); // Start timing
    try {
      const localFiles = await listLocalFiles(localDir);
      const remoteFiles = await listRemoteFiles(remoteDir);

      const comparisonFileNode = ComparisonFileNode.compareFileNodes(localFiles, remoteFiles);
      StatusBarManager.showMessage("Comparing done!", "", "", 3000, "check");

      if (remoteFiles) {
        const remoteFilesMap = new Map<string, FileNode>();
        let rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
        remoteFilesMap.set(rootFolderName, remoteFiles);

        await this.jsonManager.updateFullJson(JsonType.REMOTE, remoteFilesMap);
      }

      return comparisonFileNode;
    } catch (error) {
      StatusBarManager.showMessage("SFTP operation failed", "", "", 3000, "error");
      logErrorMessage("<getComparisonFileNode> Error:", LOG_FLAGS.CONSOLE_ONLY, error);
      throw Error("Error getting ComparisonFileNode");
    } finally {
      const endTime = performance.now(); // End timing
      const executionTime = endTime - startTime; // Calculate the elapsed time in milliseconds
      logInfoMessage(`Comparing directories execution time: ${executionTime.toFixed(2)} ms`); // Log the execution time
    }
  }

  async updateRootElements(action: Action, element: ComparisonFileNode): Promise<ComparisonFileNode> {
    let updatedElement: ComparisonFileNode;

    switch (action) {
      case Action.Add:
        updatedElement = await JsonManager.addComparisonFileNode(element, this.rootElements);
        break;

      case Action.Remove:
        updatedElement = await JsonManager.deleteComparisonFileNode(element, this.rootElements);
        break;

      case Action.Update:
        updatedElement = await JsonManager.updateComparisonFileNode(element, this.rootElements);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Save changes to JSON after rootElements is updated
    await this.jsonManager.updateFullJson(JsonType.COMPARE, this.rootElements);

    return updatedElement; // Ensure the function still returns the updated node
  }

  private applyViewMode(nodes: ComparisonFileNode[]): ComparisonFileNode[] {
    const viewNodes: ComparisonFileNode[] = [];

    const recurse = (currentNodes: ComparisonFileNode[], parentNode?: ComparisonFileNode) => {
      for (const node of currentNodes) {
        // Handle root node specifically in flatten mode
        if (!this._showAsTree && node.relativePath === "") {
          // Create a new root node that will be shown in flatten mode
          const rootNodeCopy = new ComparisonFileNode(node.name, node.type, node.size, node.modifiedTime, node.relativePath, node.status);

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
