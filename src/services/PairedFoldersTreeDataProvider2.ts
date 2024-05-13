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
} from "../utilities/filesUtils";
import { FileMap } from "src/types/FileTypes";
import { FileEntry } from "src/services/FileEntry";

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
      Object.entries(element.children).length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
  }

  async getChildren(element?: FileEntry): Promise<FileEntry[]> {
    if (!element) {
      const rootItems: FileEntry[] = [];
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
          const rootFileEntry: FileEntry = new FileEntry(
            rootName,
            "directory",
            0,
            new Date(),
            "local",
            "./",
            "unchanged",
          );
          for (const [fileName, fileEntry] of await this.compareDirectories(
            localPath,
            remotePath,
          )) {
            rootFileEntry.addChild(fileEntry);
          }

          rootItems.push(rootFileEntry);
        }
        console.log("getChildren rootItems: ", rootItems);
      }
      return rootItems;
    } else {
      // If element provided, return its children
      const fileMapArr: FileEntry[] = [];

      return fileMapArr;
    }
  }

  async compareDirectories(
    localDir: string,
    remoteDir: string,
  ): Promise<FileEntry[]> {
    let differences: FileEntry[] = [];
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
