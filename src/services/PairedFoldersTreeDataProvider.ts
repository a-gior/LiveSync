import * as vscode from "vscode";
import { ensureDirectoryExists } from "../utilities/fileUtils/fileOperations";
import { isRootPath } from "../utilities/fileUtils/filePathUtils";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "../utilities/fileUtils/fileListing";
import {
  getIconForFile,
  getIconForFolder,
  loadFolderIconMappings,
  loadIconMappings,
  loadLanguageIdMappings,
} from "./IconLoader";
import {
  FOLDER_ICON_MAPPINGS_PATH,
  LANGUAGEIDS_ICON_MAPPINGS_PATH,
  ICON_MAPPINGS_PATH,
  DEFAULT_FILE_ICON_PATH,
  DEFAULT_FOLDER_ICON,
  SAVE_DIR,
} from "../utilities/constants";
import JsonManager, {
  isComparisonFileNodeMap,
  JsonType,
} from "../managers/JsonManager";
import {
  ComparisonFileNode,
  ComparisonStatus,
} from "../utilities/ComparisonFileNode";
import { BaseNode, BaseNodeType } from "../utilities/BaseNode";
import {
  LOG_FLAGS,
  logErrorMessage,
  logInfoMessage,
} from "../managers/LogManager";
import { StatusBarManager } from "../managers/StatusBarManager";
import { FileNode } from "../utilities/FileNode";
import path from "path";
import { Action } from "../utilities/enums";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<ComparisonFileNode>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ComparisonFileNode | undefined | void
  > = new vscode.EventEmitter<ComparisonFileNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ComparisonFileNode | undefined | void
  > = this._onDidChangeTreeData.event;

  private _showUnchanged: boolean;
  private _showAsTree: boolean;

  public rootElements: Map<string, ComparisonFileNode> = new Map<
    string,
    ComparisonFileNode
  >();
  private jsonManager: JsonManager;

  constructor(showAsTree: boolean = true, showUnchanged: boolean = true) {
    this._showAsTree = showAsTree;
    this._showUnchanged = showUnchanged;
    this.jsonManager = JsonManager.getInstance();

    loadIconMappings(ICON_MAPPINGS_PATH);
    loadFolderIconMappings(FOLDER_ICON_MAPPINGS_PATH);
    loadLanguageIdMappings(LANGUAGEIDS_ICON_MAPPINGS_PATH);
  }

  toggleViewMode(showAsTree: boolean): void {
    this._showAsTree = showAsTree;
    this.refresh();
  }

  setShowUnchanged(showUnchanged: boolean): void {
    this._showUnchanged = showUnchanged;
    this.refresh();
  }

  async loadRootElements(): Promise<void> {
    // Simulate async loading of root elements (e.g., from a JSON file)
    const comparisonEntries = await this.jsonManager.getFileEntriesMap(
      JsonType.COMPARE,
    );

    if (comparisonEntries && isComparisonFileNodeMap(comparisonEntries)) {
      this.rootElements = comparisonEntries;
      console.log(" $$$$$$$$$$$$$$ Root elements loaded:", this.rootElements); // Debug log
    }
  }

  async refresh(element?: ComparisonFileNode): Promise<void> {
    if (!element) {
      this._onDidChangeTreeData.fire(undefined);
    } else {
      let parentNode;

      const pathParts = element.relativePath.split(path.sep);
      if (element.isDirectory() && pathParts.length > 1) {
        parentNode = element;
      } else if (!element.isDirectory() && pathParts.length > 1) {
        const parentPathParts = pathParts.slice(0, pathParts.length - 1);
        parentNode = await JsonManager.findNodeByPath(
          parentPathParts.join(path.sep),
          this.rootElements,
          element.pairedFolderName,
        );
      } else {
        parentNode = this.rootElements.get(element.pairedFolderName);
      }

      if (parentNode && parentNode instanceof ComparisonFileNode) {
        logInfoMessage("Refreshing Tree: ", LOG_FLAGS.CONSOLE_ONLY, parentNode);
        this._onDidChangeTreeData.fire(parentNode);
        this.jsonManager.updateFullJson(JsonType.COMPARE, this.rootElements);
      }
    }
  }

  async getTreeItem(element: ComparisonFileNode): Promise<vscode.TreeItem> {
    const isOpened = (await this.jsonManager.getFoldersState()).has(
      JsonManager.getMapKey(element),
    );

    let label: string;
    if (element.relativePath === "" || this._showAsTree) {
      label = element.name;
    } else {
      label = element.relativePath;
    }

    let collapsibleState: vscode.TreeItemCollapsibleState;
    if (
      element.type === BaseNodeType.directory &&
      (this._showAsTree || element.relativePath === "")
    ) {
      collapsibleState = isOpened
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    const treeItem = new vscode.TreeItem(label, collapsibleState);

    if (element.status && element.type) {
      if (
        WorkspaceConfigManager.getPairedFoldersConfigured() &&
        isRootPath(
          element.relativePath,
          WorkspaceConfigManager.getPairedFoldersConfigured(),
        )
      ) {
        treeItem.iconPath = getIconForFolder(
          "root_folder",
          DEFAULT_FOLDER_ICON,
        );
      } else {
        treeItem.iconPath =
          element.type === BaseNodeType.directory
            ? getIconForFolder(element.name, DEFAULT_FOLDER_ICON)
            : getIconForFile(element.name, DEFAULT_FILE_ICON_PATH);
      }
      treeItem.contextValue = `fileEntry-${element.type}-${element.status}`;
      treeItem.description = ComparisonStatus[element.status];
      const query = `?status=${ComparisonStatus[element.status]}`;
      treeItem.resourceUri = vscode.Uri.file(element.relativePath).with({
        query,
      });
    }

    return treeItem;
  }

  async getChildren(
    element?: ComparisonFileNode,
  ): Promise<ComparisonFileNode[]> {
    if (!element) {
      try {
        const comparisonEntries = await this.jsonManager.getFileEntriesMap(
          JsonType.COMPARE,
        );

        if (!comparisonEntries || comparisonEntries.size === 0) {
          ensureDirectoryExists(SAVE_DIR);
          const pairedFolders =
            WorkspaceConfigManager.getPairedFoldersConfigured();

          for (const { localPath, remotePath } of pairedFolders) {
            const comparisonFileNode = await this.getComparisonFileNode(
              localPath,
              remotePath,
            );
            this.rootElements.set(comparisonFileNode.name, comparisonFileNode);
          }

          await this.jsonManager.updateFullJson(
            JsonType.COMPARE,
            this.rootElements,
          );

          const rootNodes = BaseNode.toArray(this.rootElements);
          return this.applyViewMode(rootNodes);
        } else if (
          comparisonEntries &&
          isComparisonFileNodeMap(comparisonEntries)
        ) {
          this.rootElements = comparisonEntries;
          const rootNodes = BaseNode.toArray(this.rootElements);
          return this.applyViewMode(rootNodes);
        } else {
          throw Error(
            "Comparison JSON data not found. Please run the initial comparison.",
          );
        }
      } catch (error) {
        logErrorMessage(
          "Error fetching comparison data:",
          LOG_FLAGS.ALL,
          error,
        );
        return [];
      }
    } else {
      const childrenArray = Array.from(element.children.values());
      return this.applyViewMode(childrenArray);
    }
  }

  getParent(
    element: ComparisonFileNode,
  ): vscode.ProviderResult<ComparisonFileNode> {
    if (!element.relativePath || element.relativePath === "") {
      // Root nodes do not have a parent
      return null;
    }

    const parentPath = path.dirname(element.relativePath);
    return JsonManager.findNodeByPath(
      parentPath,
      this.rootElements,
      element.pairedFolderName,
    );
  }

  // Get the whole ComparisonFileNode of the whole tree
  async getComparisonFileNode(
    localDir: string,
    remoteDir: string,
  ): Promise<ComparisonFileNode> {
    const startTime = performance.now(); // Start timing
    try {
      console.log(`Comparing Directories...`);
      const localFiles = await listLocalFilesRecursive(localDir);
      const remoteFiles = await listRemoteFilesRecursive(remoteDir);

      const comparisonFileNode = ComparisonFileNode.compareFileNodes(
        localFiles,
        remoteFiles,
      );

      if (remoteFiles) {
        const remoteFilesMap = new Map<string, FileNode>();
        remoteFilesMap.set(remoteFiles.pairedFolderName, remoteFiles);

        console.log("Saving JSON REMOTE Map: ", remoteFilesMap);
        await this.jsonManager.updateFullJson(JsonType.REMOTE, remoteFilesMap);
      }

      return comparisonFileNode;
    } catch (error) {
      StatusBarManager.showMessage(
        "SFTP operation failed",
        "",
        "",
        3000,
        "error",
      );
      console.error("<getComparisonFileNode> Error:", error);
      throw Error("Error getting ComparisonFileNode");
    } finally {
      const endTime = performance.now(); // End timing
      const executionTime = endTime - startTime; // Calculate the elapsed time in milliseconds
      console.log(
        `Comparing directories execution time: ${executionTime.toFixed(2)} ms`,
      ); // Log the execution time
    }
  }

  async updateRootElements(
    action: Action,
    element: ComparisonFileNode,
  ): Promise<ComparisonFileNode> {
    switch (action) {
      case Action.Add:
        // Handle adding the element
        return await JsonManager.addComparisonFileNode(
          element,
          this.rootElements,
        );

      case Action.Remove:
        // Handle deleting the element
        return await JsonManager.deleteComparisonFileNode(
          element,
          this.rootElements,
        );

      case Action.Update:
        // Handle updating the element that exists
        return await JsonManager.updateComparisonFileNode(
          element,
          this.rootElements,
        );

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private applyViewMode(nodes: ComparisonFileNode[]): ComparisonFileNode[] {
    const viewNodes: ComparisonFileNode[] = [];

    const recurse = (
      currentNodes: ComparisonFileNode[],
      parentNode?: ComparisonFileNode,
    ) => {
      for (const node of currentNodes) {
        // Handle root node specifically in flatten mode
        if (!this._showAsTree && node.relativePath === "") {
          // Create a new root node that will be shown in flatten mode
          const rootNodeCopy = new ComparisonFileNode(
            node.name,
            node.pairedFolderName,
            node.type,
            node.size,
            node.modifiedTime,
            node.relativePath,
            node.status,
          );

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
                (node.isDirectory() &&
                  (node.status === ComparisonStatus.added ||
                    node.status === ComparisonStatus.removed)) ||
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

    return viewNodes;
  }
}
