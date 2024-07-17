import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import {
  FileEntry,
  FileEntryStatus,
  FileEntryType,
} from "../utilities/FileEntry";
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
import FileEntryManager, { JsonType } from "./FileEntryManager";

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<FileEntry>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    FileEntry | undefined | void
  > = new vscode.EventEmitter<FileEntry | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FileEntry | undefined | void> =
    this._onDidChangeTreeData.event;

  private rootElements: FileEntry[] = [];
  readonly workspaceConfiguration: ConfigurationState =
    WorkspaceConfig.getAll();

  private fileEntryManager: FileEntryManager;

  constructor() {
    this.fileEntryManager = FileEntryManager.getInstance();

    loadIconMappings(ICON_MAPPINGS_PATH);
    loadFolderIconMappings(FOLDER_ICON_MAPPINGS_PATH);
    loadLanguageIdMappings(LANGUAGEIDS_ICON_MAPPINGS_PATH);
  }

  refresh(element?: FileEntry): void {
    if (!element) {
      console.debug("################ Refresh all ################");
    }
    this._onDidChangeTreeData.fire(element);
  }

  public async addElement(
    newElement: FileEntry,
    parentElement?: FileEntry,
  ): Promise<void> {
    if (parentElement) {
      parentElement.addChild(newElement);
      await this.fileEntryManager.updateJsonFileEntry(
        parentElement,
        JsonType.COMPARE,
      );
      this.refresh(parentElement);
    } else {
      this.rootElements.push(newElement);
      await this.fileEntryManager.updateJsonFileEntry(
        newElement,
        JsonType.COMPARE,
      );
      this.refresh();
    }
  }

  public async removeElement(
    elementToRemove: FileEntry,
    parentElement?: FileEntry,
  ): Promise<void> {
    if (parentElement) {
      parentElement.removeChild(elementToRemove.name);
      await this.fileEntryManager.updateJsonFileEntry(
        parentElement,
        JsonType.COMPARE,
      );
      this.refresh(parentElement);
    } else {
      this.rootElements = this.rootElements.filter(
        (element) => element !== elementToRemove,
      );
      await this.fileEntryManager.updateJsonFileEntry(
        elementToRemove,
        JsonType.COMPARE,
      );
      this.refresh();
    }
  }

  getTreeItem(element: FileEntry): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.name,
      element.type === FileEntryType.directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    if (element.status && element.type) {
      if (
        this.workspaceConfiguration.pairedFolders &&
        isRootPath(element.fullPath, this.workspaceConfiguration.pairedFolders)
      ) {
        treeItem.iconPath = getIconForFolder(
          "root_folder",
          DEFAULT_FOLDER_ICON,
        );
      } else {
        treeItem.iconPath =
          element.type === FileEntryType.directory
            ? getIconForFolder(element.name, DEFAULT_FOLDER_ICON)
            : getIconForFile(element.name, DEFAULT_FILE_ICON_PATH);
      }
      treeItem.contextValue = `fileEntry-${element.type}`;
      treeItem.description = FileEntryStatus[element.status];
      const query = `?status=${FileEntryStatus[element.status]}`;
      treeItem.resourceUri = vscode.Uri.file(element.fullPath).with({ query });
    }
    return treeItem;
  }

  async getChildren(element?: FileEntry): Promise<FileEntry[]> {
    await this.fileEntryManager.waitForJsonLoad();

    if (!element) {
      try {
        const comparisonEntries =
          this.fileEntryManager.getComparisonFileEntries();
        console.log(`ComparisonEntries: `, comparisonEntries);

        if (!comparisonEntries || comparisonEntries.size === 0) {
          let rootFileEntries: FileEntry[] = [];
          const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();

          for (const { localPath, remotePath } of pairedFolders) {
            ensureDirectoryExists(SAVE_DIR);
            const children: Map<string, FileEntry> =
              await this.getDirectoriesComparison(localPath, remotePath);
            let workspaceEntry = children.get(path.basename(localPath));
            if (workspaceEntry instanceof FileEntry) {
              await this.fileEntryManager.updateJsonFileEntry(
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

  async getDirectoriesComparison(
    localDir: string,
    remoteDir: string,
  ): Promise<Map<string, FileEntry>> {
    try {
      console.log(`Comparing Directories...`);

      const localFiles = await listLocalFilesRecursive(localDir);
      console.log("Saving JSON LOCAL: ", localFiles);
      await this.fileEntryManager.updateJsonFileEntry(
        localFiles,
        JsonType.LOCAL,
      );

      const remoteFiles = await listRemoteFilesRecursive(remoteDir);
      console.log("Saving JSON REMOTE: ", localFiles);
      await this.fileEntryManager.updateJsonFileEntry(
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
    rootEntries: FileEntry[] = this.rootElements,
  ): FileEntry | undefined {
    const relativePath = getRelativePath(filePath);
    if (!relativePath) {
      return undefined;
    }
    const pathParts = relativePath.split(path.sep);

    let currentEntries = rootEntries;
    let foundEntry: FileEntry | undefined;

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
