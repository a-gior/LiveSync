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
import { WorkspaceConfig } from "./WorkspaceConfig";
import FileNodeManager, {
  isComparisonFileNodeMap,
  JsonType,
} from "./FileNodeManager";
import {
  ComparisonFileNode,
  ComparisonStatus,
} from "../utilities/ComparisonFileNode";
import { BaseNode, BaseNodeType } from "../utilities/BaseNode";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { StatusBarManager } from "./StatusBarManager";
import { FileNode } from "../utilities/FileNode";
import path from "path";
import { Action } from "../utilities/enums";

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
  private fileNodeManager: FileNodeManager;

  constructor() {
    this._showAsTree = true;
    this._showUnchanged = false;
    this.loadParameters();
    this.fileNodeManager = FileNodeManager.getInstance();

    loadIconMappings(ICON_MAPPINGS_PATH);
    loadFolderIconMappings(FOLDER_ICON_MAPPINGS_PATH);
    loadLanguageIdMappings(LANGUAGEIDS_ICON_MAPPINGS_PATH);
  }

  loadParameters(): void {
    this._showUnchanged =
      WorkspaceConfig.getParameter<boolean>("showUnchanged") ?? false;
  }

  async loadRootElements(): Promise<void> {
    // Simulate async loading of root elements (e.g., from a JSON file)
    const comparisonEntries = await this.fileNodeManager.getFileEntriesMap(
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
        parentNode = await FileNodeManager.findEntryByPath(
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
        this.fileNodeManager.updateFullJson(
          JsonType.COMPARE,
          this.rootElements,
        );
      }
    }
  }

  getTreeItem(element: ComparisonFileNode): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      // If relativePath is empty, use element.name
      element.relativePath === ""
        ? element.name
        : this._showAsTree
          ? element.name
          : element.relativePath,
      // Determine the collapsible state based on the type and relativePath
      element.type === BaseNodeType.directory &&
      (this._showAsTree || element.relativePath === "")
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    if (element.status && element.type) {
      if (
        WorkspaceConfig.getPairedFoldersConfigured() &&
        isRootPath(
          element.relativePath,
          WorkspaceConfig.getPairedFoldersConfigured(),
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
        const comparisonEntries = await this.fileNodeManager.getFileEntriesMap(
          JsonType.COMPARE,
        );

        if (!comparisonEntries || comparisonEntries.size === 0) {
          ensureDirectoryExists(SAVE_DIR);
          const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();

          for (const { localPath, remotePath } of pairedFolders) {
            const comparisonFileNode = await this.getComparisonFileNode(
              localPath,
              remotePath,
            );
            this.rootElements.set(comparisonFileNode.name, comparisonFileNode);
          }

          await this.fileNodeManager.updateFullJson(
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
        await this.fileNodeManager.updateFullJson(
          JsonType.REMOTE,
          remoteFilesMap,
        );
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
        return await FileNodeManager.addComparisonFileNode(
          element,
          this.rootElements,
        );

      case Action.Remove:
        // Handle deleting the element
        return await FileNodeManager.deleteComparisonFileNode(
          element,
          this.rootElements,
        );

      case Action.Update:
        // Handle updating the element that exists
        return await FileNodeManager.updateComparisonFileNode(
          element,
          this.rootElements,
        );

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private filterUnchangedNodes(
    nodes: ComparisonFileNode[],
  ): ComparisonFileNode[] {
    return nodes
      .filter((node) => node.status !== "unchanged")
      .map((node) => {
        if (node.children && node.children.size > 0) {
          // Recursively filter the children
          const filteredChildren = this.filterUnchangedNodes(
            Array.from(node.children.values()),
          );
          node.children = new Map(
            filteredChildren.map((child) => [child.name, child]),
          );
        }
        return node;
      });
  }

  toggleViewMode(showAsTree: boolean): void {
    this._showAsTree = showAsTree;
    this.refresh();
  }

  private applyViewMode(nodes: ComparisonFileNode[]): ComparisonFileNode[] {
    if (this._showAsTree) {
      // Show as a tree structure, with optional filtering applied recursively
      return this._showUnchanged ? nodes : this.filterUnchangedNodes(nodes);
    } else {
      // Show as a flat list, applying both flattening and filtering recursively
      return this.flattenNodes(nodes, !this._showUnchanged);
    }
  }

  private flattenNodes(
    nodes: ComparisonFileNode[],
    filterUnchanged: boolean,
  ): ComparisonFileNode[] {
    const result: ComparisonFileNode[] = [];

    const recurse = (currentNodes: ComparisonFileNode[]) => {
      for (const node of currentNodes) {
        // Apply the filter directly during the traversal
        if (filterUnchanged && node.status === "unchanged") {
          continue; // Skip unchanged nodes if filterUnchanged is true
        }

        result.push(node);
        if (node.children && node.children.size > 0) {
          recurse(Array.from(node.children.values()));
        }
      }
    };

    recurse(nodes);
    return result;
  }
}
