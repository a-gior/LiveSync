import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
  compareFileMaps,
  listLocalFilesRecursive2,
  listRemoteFilesRecursive2,
} from "../utilities/filesUtils";
import { FileMap } from "src/types/FileTypes";
import {
  FileEntry,
  FileEntryStatus,
  FileEntryType,
} from "../services/FileEntry";

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
    console.log("GetTreeItem: ", element);

    return new vscode.TreeItem(
      element.name,
      element.type === FileEntryType.directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
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
          console.log("getChildren localPath: ", localPath);
          const rootName: string = `[local] ${path.basename(localPath)} <=> ${path.basename(remotePath)} [remote]`;
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
        console.log("getChildren rootItems: ", rootItems);
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
    let differences: Map<string, FileEntry> = new Map();
    try {
      // List files and folders in the remote directory
      const localFiles = await listLocalFilesRecursive2(localDir);
      const remoteFiles = await listRemoteFilesRecursive2(remoteDir);

      console.log("Local Files: ", localFiles);
      console.log("Remote Files: ", remoteFiles);

      differences = FileEntry.compareDirectories(localFiles, remoteFiles);
      console.log("Differences in Files: ", differences);
    } catch (error) {
      console.error("Error:", error);
    }

    return differences;
  }
}
