import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import {
  FileEntry,
  FileEntrySource,
  FileEntryStatus,
  FileEntryType,
} from "../utilities/FileEntry";
import {
  ensureDirectoryExists,
  saveToFile,
} from "../utilities/fileUtils/fileOperations";
import {
  comparePaths,
  getLocalPath,
  getRelativePath,
  getRemotePath,
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
    ConfigurationPanel.getWorkspaceConfiguration();

  constructor() {
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

  addElement(newElement: FileEntry, parentElement?: FileEntry): void {
    if (parentElement) {
      parentElement.addChild(newElement);
      this.refresh(parentElement);
    } else {
      this.rootElements.push(newElement);
      this.refresh();
    }
  }

  removeElement(elementToRemove: FileEntry, parentElement?: FileEntry): void {
    if (parentElement) {
      parentElement.removeChild(elementToRemove.name);
      this.refresh(parentElement);
    } else {
      this.rootElements = this.rootElements.filter(
        (element) => element !== elementToRemove,
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
    if (!element) {
      let rootFileEntries: FileEntry[] = [];
      if (
        !this.workspaceConfiguration.configuration ||
        !this.workspaceConfiguration.pairedFolders ||
        this.workspaceConfiguration.pairedFolders.length === 0
      ) {
        vscode.window.showErrorMessage("Please configure the plugin");
      } else {
        const pairedFolders: { localPath: string; remotePath: string }[] =
          this.workspaceConfiguration.pairedFolders;
        for (const { localPath, remotePath } of pairedFolders) {
          const rootName: string = `[local] ${path.basename(localPath)} / ${path.basename(remotePath)} [remote]`;
          ensureDirectoryExists(SAVE_DIR);
          const children: Map<string, FileEntry> =
            await this.getDirectoriesComparison(
              localPath,
              remotePath,
              SAVE_DIR,
            );
          let workspaceEntry = children.get(path.basename(localPath));
          if (workspaceEntry instanceof FileEntry) {
            workspaceEntry.name = rootName;
            rootFileEntries.push(workspaceEntry);
          } else {
            console.error("Workspace entry error: ", workspaceEntry);
          }
        }
      }
      this.rootElements = rootFileEntries;
      return this.rootElements;
    } else {
      return [...element.children.values()];
    }
  }

  async getDirectoriesComparison(
    localDir: string,
    remoteDir: string,
    saveDir: string,
  ): Promise<Map<string, FileEntry>> {
    try {
      const localFiles = await listLocalFilesRecursive(localDir);
      const remoteFiles = await listRemoteFilesRecursive(remoteDir);
      const compareFiles = await FileEntry.compareDirectories(
        localFiles,
        remoteFiles,
      );
      await saveToFile(
        localFiles.toJSON(),
        path.join(saveDir, "localFiles.json"),
      );
      await saveToFile(
        remoteFiles.toJSON(),
        path.join(saveDir, "remoteFiles.json"),
      );
      await saveToFile(
        Object.fromEntries(compareFiles.entries()),
        path.join(saveDir, "compareFiles.json"),
      );
      return compareFiles;
    } catch (error) {
      console.error("Error:", error);
      return new Map();
    }
  }

  findEntryByPath(
    filePath: string,
    fileSource: FileEntrySource,
    rootEntries: FileEntry[] = this.rootElements,
  ): FileEntry | undefined {
    const pairedFolders = this.workspaceConfiguration.pairedFolders || [];
    const relativePath = getRelativePath(pairedFolders, filePath, fileSource);
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
