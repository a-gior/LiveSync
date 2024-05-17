import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "../utilities/filesUtils";
import {
  FileEntry,
  FileEntryStatus,
  FileEntryType,
} from "../utilities/FileEntry";

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<FileEntry>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    FileEntry[] | undefined | void
  > = new vscode.EventEmitter<FileEntry[] | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FileEntry[] | undefined | void> =
    this._onDidChangeTreeData.event;

  readonly workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileEntry): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.name,
      element.type === FileEntryType.directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    if (element.status && element.type) {
      treeItem.iconPath = this.getIconPathForType(element.type);
      treeItem.description = FileEntryStatus[element.status];
      treeItem.contextValue = `fileEntry-${FileEntryStatus[element.status]}`;

      const query = `?status=${FileEntryStatus[element.status]}`;
      treeItem.resourceUri = vscode.Uri.file(element.fullPath).with({ query });
    }

    return treeItem;
  }

  async getChildren(element?: FileEntry): Promise<FileEntry[]> {
    if (!element) {
      let rootItems: FileEntry[] = [];
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
          const children: Map<string, FileEntry> =
            await this.compareDirectories(localPath, remotePath);

          let workspaceEntry = children.get(path.basename(localPath));
          if (workspaceEntry instanceof FileEntry) {
            workspaceEntry.name = rootName;
            rootItems.push(workspaceEntry);
          } else {
            console.error("Workspace entry error: ", workspaceEntry);
          }
        }
      }
      return rootItems;
    } else {
      // If element provided, return its children
      return [...element.children.values()];
    }
  }

  async compareDirectories(
    localDir: string,
    remoteDir: string,
  ): Promise<Map<string, FileEntry>> {
    try {
      const localFiles = await listLocalFilesRecursive(localDir);
      const remoteFiles = await listRemoteFilesRecursive(remoteDir);

      return FileEntry.compareDirectories(localFiles, remoteFiles);
    } catch (error) {
      console.error("Error:", error);
      return new Map();
    }
  }

  private getIconPathForStatus(
    status: FileEntryStatus,
  ): vscode.ThemeIcon | { light: string; dark: string } {
    const iconFolderPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "resources",
      "media",
      "dark",
    );
    switch (status) {
      case FileEntryStatus.added:
        return {
          light: path.join(iconFolderPath, "added.svg"),
          dark: path.join(iconFolderPath, "added.svg"),
        };
      case FileEntryStatus.removed:
        return {
          light: path.join(iconFolderPath, "removed.svg"),
          dark: path.join(iconFolderPath, "removed.svg"),
        };
      case FileEntryStatus.modified:
        return {
          light: path.join(iconFolderPath, "modified.svg"),
          dark: path.join(iconFolderPath, "modified.svg"),
        };
      case FileEntryStatus.unchanged:
      default:
        return {
          light: path.join(iconFolderPath, "unchanged.svg"),
          dark: path.join(iconFolderPath, "unchanged.svg"),
        };
    }
  }

  private getIconPathForType(
    status: FileEntryType,
  ): vscode.ThemeIcon | { light: string; dark: string } {
    const iconFolderPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "resources",
      "media",
      "dark",
    );
    switch (status) {
      case FileEntryType.directory:
        return {
          light: path.join(iconFolderPath, "directory.svg"),
          dark: path.join(iconFolderPath, "directory.svg"),
        };
      case FileEntryType.file:
      default:
        return {
          light: path.join(iconFolderPath, "file.svg"),
          dark: path.join(iconFolderPath, "file.svg"),
        };
    }
  }
}
