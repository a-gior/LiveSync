import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "../utilities/fileUtils/fileListing";
import {
  FileEntry,
  FileEntryStatus,
  FileEntryType,
} from "../utilities/FileEntry";
import {
  saveToFile,
  ensureDirectoryExists,
} from "../utilities/fileUtils/fileOperations";
import {
  FOLDER_ICON_MAPPINGS_PATH,
  LANGUAGEIDS_ICON_MAPPINGS_PATH,
  SAVE_DIR,
} from "../utilities/constants";
import { isRootPath } from "../utilities/fileUtils/filePathUtils";
import {
  getIconForFile,
  getIconForFolder,
  loadFolderIconMappings,
  loadIconMappings,
  loadLanguageIdMappings,
} from "./IconLoader";
import {
  DEFAULT_FILE_ICON_PATH,
  DEFAULT_FOLDER_ICON,
  ICON_MAPPINGS_PATH,
} from "../utilities/constants";

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<FileEntry>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    FileEntry[] | FileEntry | undefined | void
  > = new vscode.EventEmitter<FileEntry[] | FileEntry | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    FileEntry[] | FileEntry | undefined | void
  > = this._onDidChangeTreeData.event;

  readonly workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();

  constructor() {
    loadIconMappings(ICON_MAPPINGS_PATH);
    loadFolderIconMappings(FOLDER_ICON_MAPPINGS_PATH);
    loadLanguageIdMappings(LANGUAGEIDS_ICON_MAPPINGS_PATH);
  }

  refresh(element?: FileEntry[] | FileEntry | void): void {
    console.log(`TreeProvider refresh: `, element);
    this._onDidChangeTreeData.fire(element);
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
        treeItem.contextValue = "fileEntry-rootFolder";
        treeItem.iconPath = getIconForFolder(
          "root_folder",
          DEFAULT_FOLDER_ICON,
        );
      } else {
        treeItem.contextValue = `fileEntry-${element.type}-${FileEntryStatus[element.status]}`;

        // treeItem.iconPath = this.getIconPathForType(element.type);
        if (element.type === FileEntryType.directory) {
          treeItem.iconPath = getIconForFolder(
            element.name,
            DEFAULT_FOLDER_ICON,
          );
        } else {
          treeItem.iconPath = getIconForFile(
            element.name,
            DEFAULT_FILE_ICON_PATH,
          );
        }
      }

      treeItem.description = FileEntryStatus[element.status];

      const query = `?status=${FileEntryStatus[element.status]}`;
      treeItem.resourceUri = vscode.Uri.file(element.fullPath).with({ query });
    }
    return treeItem;
  }

  async getChildren(element?: FileEntry): Promise<FileEntry[]> {
    if (!element) {
      let rootFileEntries: FileEntry[] = [];
      // If no element provided, get the root items (local folders)
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
      return rootFileEntries;
    } else {
      // If element provided, return its children
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
}
