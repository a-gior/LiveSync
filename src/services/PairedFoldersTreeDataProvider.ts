import * as vscode from "vscode";
import * as path from "path";
import { ensureDirectoryExists } from "../utilities/fileUtils/fileOperations";
import {
  getRelativePath,
  isRootPath,
} from "../utilities/fileUtils/filePathUtils";
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
import FileNodeManager, { JsonType } from "./FileNodeManager";
import {
  ComparisonFileNode,
  ComparisonStatus,
} from "../utilities/ComparisonFileNode";
import { BaseNode, BaseNodeType } from "../utilities/BaseNode";
import { LOG_FLAGS, logErrorMessage } from "./LogManager";

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<ComparisonFileNode>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ComparisonFileNode | undefined | void
  > = new vscode.EventEmitter<ComparisonFileNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ComparisonFileNode | undefined | void
  > = this._onDidChangeTreeData.event;

  private rootElements: Map<string, ComparisonFileNode> = new Map<
    string,
    ComparisonFileNode
  >();
  private fileNodeManager: FileNodeManager;

  constructor() {
    this.fileNodeManager = FileNodeManager.getInstance();

    loadIconMappings(ICON_MAPPINGS_PATH);
    loadFolderIconMappings(FOLDER_ICON_MAPPINGS_PATH);
    loadLanguageIdMappings(LANGUAGEIDS_ICON_MAPPINGS_PATH);
  }

  refresh(element?: ComparisonFileNode): void {
    if (!element) {
      console.debug("################ Refresh all ################");
      this._onDidChangeTreeData.fire(undefined);
    } else {
      // Find the corresponding element in the tree using findEntryByPath
      let foundElement = this.findEntryByPath(element.relativePath, true);
      if (foundElement) {
        Object.assign(foundElement, element);
        this._onDidChangeTreeData.fire(foundElement);
      } else {
        console.warn("Element not found in tree structure:", element);
      }
    }
  }

  public async addElement(
    newElement: ComparisonFileNode,
    parentElement?: ComparisonFileNode,
  ): Promise<void> {
    if (parentElement) {
      parentElement.addChild(newElement);
      await this.fileNodeManager.updateJsonFileNode(
        parentElement,
        JsonType.COMPARE,
      );
      this.refresh(parentElement);
    } else {
      this.rootElements.set(newElement.name, newElement);
      await this.fileNodeManager.updateFullJson(
        JsonType.COMPARE,
        this.rootElements,
      );
      this.refresh();
    }
  }

  public async removeElement(
    elementToRemove: ComparisonFileNode,
    parentElement?: ComparisonFileNode,
  ): Promise<void> {
    if (parentElement) {
      parentElement.removeChild(elementToRemove.name);
      await this.fileNodeManager.updateJsonFileNode(
        parentElement,
        JsonType.COMPARE,
      );
      this.refresh(parentElement);
    } else {
      this.rootElements.delete(elementToRemove.name);

      await this.fileNodeManager.updateFullJson(
        JsonType.COMPARE,
        this.rootElements,
      );
      this.refresh();
    }
  }

  getTreeItem(element: ComparisonFileNode): vscode.TreeItem {
    console.log("GetTreeItem", element);
    const treeItem = new vscode.TreeItem(
      element.name,
      element.type === BaseNodeType.directory
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
      treeItem.contextValue = `fileEntry-${element.type}`;
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
    await this.fileNodeManager.waitForJsonLoad();

    if (!element) {
      try {
        const comparisonEntries =
          this.fileNodeManager.getComparisonFileEntries();
        console.log(`ComparisonEntries: `, comparisonEntries);

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

          return BaseNode.toArray(this.rootElements);
        } else if (comparisonEntries) {
          this.rootElements = comparisonEntries;
          return BaseNode.toArray(this.rootElements);
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
      return Array.from(element.children.values());
    }
  }

  async getComparisonFileNode(
    localDir: string,
    remoteDir: string,
  ): Promise<ComparisonFileNode> {
    try {
      console.log(`Comparing Directories...`);

      const localFiles = await listLocalFilesRecursive(localDir);
      const remoteFiles = await listRemoteFilesRecursive(remoteDir);

      const comparisonFileNode = ComparisonFileNode.compareFileNodes(
        localFiles,
        remoteFiles,
      );

      if (localFiles) {
        console.log("Saving JSON LOCAL: ", localFiles);
        await this.fileNodeManager.updateJsonFileNode(
          localFiles,
          JsonType.LOCAL,
        );
      }

      if (remoteFiles) {
        console.log("Saving JSON REMOTE: ", localFiles);
        await this.fileNodeManager.updateJsonFileNode(
          remoteFiles,
          JsonType.REMOTE,
        );
      }

      return comparisonFileNode;
    } catch (error) {
      console.error("Error:", error);
      throw Error("Error getting ComparisonFileNode");
    }
  }

  findEntryByPath(
    filePath: string,
    isPathRelative: boolean = false,
    rootEntries: Map<string, ComparisonFileNode> = this.rootElements,
  ): ComparisonFileNode | undefined {
    const relativePath = isPathRelative ? filePath : getRelativePath(filePath);
    if (!relativePath) {
      return undefined;
    }
    const pathParts = relativePath.split(path.sep);

    let currentEntries = rootEntries;
    let foundEntry: ComparisonFileNode | undefined;

    // If rootEntries is the same as this.rootElements, find the directory root entry
    if (currentEntries === this.rootElements) {
      for (const rootEntry of currentEntries.values()) {
        if (rootEntry.isDirectory()) {
          currentEntries = rootEntry.children;
          break;
        }
      }
    }

    for (const part of pathParts) {
      foundEntry = currentEntries.get(part);
      if (!foundEntry) {
        return undefined;
      }

      // If we've reached the last part of the path, return the found entry
      if (part === pathParts[pathParts.length - 1]) {
        return foundEntry;
      }

      if (foundEntry.isDirectory()) {
        currentEntries = foundEntry.children;
      } else {
        break; // Stop if it's a file before reaching the last part
      }
    }

    console.log(`<findEntryByPath> foundEntry: `, foundEntry);
    return foundEntry;
  }
}
