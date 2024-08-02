import * as vscode from "vscode";
import * as path from "path";
import { FileNode, FileNodeStatus, FileNodeType } from "../utilities/FileNode";
import { ensureDirectoryExists } from "../utilities/fileUtils/fileOperations";
import {
  comparePaths,
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
import { compareLocalAndRemote } from "../utilities/fileUtils/entriesComparison";
import FileNodeManager, { JsonType } from "./FileNodeManager";
import { ComparisonFileNode } from "../utilities/ComparisonFileNode";

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<ComparisonFileNode>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ComparisonFileNode | undefined | void
  > = new vscode.EventEmitter<ComparisonFileNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ComparisonFileNode | undefined | void
  > = this._onDidChangeTreeData.event;

  private rootElements: ComparisonFileNode[] = [];
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
    }
    this._onDidChangeTreeData.fire(element);
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
      this.rootElements.push(newElement);
      await this.fileNodeManager.updateJsonFileNode(
        newElement,
        JsonType.COMPARE,
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
      this.rootElements = this.rootElements.filter(
        (element) => element !== elementToRemove,
      );
      await this.fileNodeManager.updateJsonFileNode(
        elementToRemove,
        JsonType.COMPARE,
      );
      this.refresh();
    }
  }

  getTreeItem(element: ComparisonFileNode): vscode.TreeItem {
    console.log("GetTreeItem", element);
    const treeItem = new vscode.TreeItem(
      element.name,
      element.type === FileNodeType.directory
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
          element.type === FileNodeType.directory
            ? getIconForFolder(element.name, DEFAULT_FOLDER_ICON)
            : getIconForFile(element.name, DEFAULT_FILE_ICON_PATH);
      }
      treeItem.contextValue = `fileEntry-${element.type}`;
      treeItem.description = FileNodeStatus[element.status];
      const query = `?status=${FileNodeStatus[element.status]}`;
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
          let rootFileEntries: FileNode[] = [];
          const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();

          for (const { localPath, remotePath } of pairedFolders) {
            ensureDirectoryExists(SAVE_DIR);
            const children: Map<string, FileNode> =
              await this.getDirectoriesComparison(localPath, remotePath);
            let workspaceEntry = children.get(path.basename(localPath));
            if (workspaceEntry instanceof FileNode) {
              await this.fileNodeManager.updateJsonFileNode(
                workspaceEntry,
                JsonType.COMPARE,
              );

              const rootName: string = `[local] ${path.basename(localPath)} / ${path.basename(remotePath)} [remote]`;
              workspaceEntry.name = rootName;
              rootFileEntries.push(workspaceEntry);
            } else {
              console.error("Workspace entry error: ", workspaceEntry);
            }
          }
          return rootFileEntries;
        } else if (comparisonEntries) {
          this.rootElements = Array.from(comparisonEntries.values());
          return this.rootElements;
        } else {
          vscode.window.showErrorMessage(
            "Comparison JSON data not found. Please run the initial comparison.",
          );
          return [];
        }
      } catch (error) {
        console.error("Error fetching comparison data:", error);
        vscode.window.showErrorMessage("Failed to load comparison data.");
        return [];
      }
    } else {
      return [...element.children.values()];
    }
  }

  async getComparisonFileNode(
    localDir: string,
    remoteDir: string,
  ): Promise<ComparisonFileNode> {
    try {
      console.log(`Comparing Directories...`);

      const localFiles = await listLocalFilesRecursive(localDir);
      console.log("Saving JSON LOCAL: ", localFiles);
      await this.fileNodeManager.updateJsonFileNode(localFiles, JsonType.LOCAL);

      const remoteFiles = await listRemoteFilesRecursive(remoteDir);
      console.log("Saving JSON REMOTE: ", localFiles);
      await this.fileNodeManager.updateJsonFileNode(
        remoteFiles,
        JsonType.REMOTE,
      );

      return ComparisonFileNode.compareFileNodes(localFiles, remoteFiles);
    } catch (error) {
      console.error("Error:", error);
      return new Map();
    }
  }

  async getDirectoriesComparison(
    localDir: string,
    remoteDir: string,
  ): Promise<Map<string, FileNode>> {
    try {
      console.log(`Comparing Directories...`);

      const localFiles = await listLocalFilesRecursive(localDir);
      console.log("Saving JSON LOCAL: ", localFiles);
      await this.fileNodeManager.updateJsonFileNode(localFiles, JsonType.LOCAL);

      const remoteFiles = await listRemoteFilesRecursive(remoteDir);
      console.log("Saving JSON REMOTE: ", localFiles);
      await this.fileNodeManager.updateJsonFileNode(
        remoteFiles,
        JsonType.REMOTE,
      );

      const compareFiles = await compareLocalAndRemote(localFiles, remoteFiles);

      return compareFiles;
    } catch (error) {
      console.error("Error:", error);
      return new Map();
    }
  }

  findEntryByPath(
    filePath: string,
    rootEntries: FileNode[] = this.rootElements,
  ): FileNode | undefined {
    const relativePath = getRelativePath(filePath);
    if (!relativePath) {
      return undefined;
    }
    const pathParts = relativePath.split(path.sep);

    let currentEntries = rootEntries;
    let foundEntry: FileNode | undefined;

    if (currentEntries === this.rootElements) {
      for (const rootEntry of currentEntries) {
        if (rootEntry.isDirectory()) {
          currentEntries = Array.from(rootEntry.children.values());
          break;
        }
      }
    }

    for (const part of pathParts) {
      foundEntry = currentEntries.find((entry) =>
        comparePaths(entry.name, part),
      );
      if (!foundEntry) {
        return undefined;
      }
      if (foundEntry.isDirectory()) {
        currentEntries = Array.from(foundEntry.children.values());
      } else {
        break;
      }
    }

    return foundEntry;
  }
}
