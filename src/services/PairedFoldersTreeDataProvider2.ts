import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
  compareFileMaps,
} from "../utilities/filesUtils";
import { FileMap } from "src/types/FileTypes";

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<FileMap>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    FileMap[] | undefined | void
  > = new vscode.EventEmitter<FileMap[] | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FileMap[] | undefined | void> =
    this._onDidChangeTreeData.event;

  readonly workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileMap): vscode.TreeItem {
    const [fileName, fileItem] = Object.entries(element)[0];
    console.log("GetTreeItem: ", element);

    return new vscode.TreeItem(
      fileName,
      Object.entries(fileItem.children).length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
  }

  async getChildren(element?: FileMap): Promise<FileMap[]> {
    if (!element) {
      const rootItems: FileMap[] = [];
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
          const rootFileMap: FileMap = {};

          rootFileMap[rootName] = {
            type: "directory",
            size: 0,
            modifiedTime: new Date(),
            source: "local",
            status: "unchanged",
            children: await this.compareDirectories(localPath, remotePath),
          };

          rootItems.push(rootFileMap);
        }
        console.log("getChildren rootItems: ", rootItems);
      }
      return rootItems;
    } else {
      // If element provided, return its children
      const fileMapArr: FileMap[] = [];
      const [fileName, fileItem] = Object.entries(element)[0];

      console.log("getChildren element: ", element[fileName].children);
      for (const [childFileName, childFileItem] of Object.entries(
        element[fileName].children,
      )) {
        fileMapArr.push({
          [childFileName]: childFileItem,
        });
      }

      return fileMapArr;
    }
  }

  async compareDirectories(
    localDir: string,
    remoteDir: string,
  ): Promise<FileMap> {
    let differences: FileMap = {};
    try {
      // List files and folders in the remote directory
      const localFiles = await listLocalFilesRecursive(localDir);
      const remoteFiles = await listRemoteFilesRecursive(remoteDir);

      console.log("Local Files: ", localFiles);
      console.log("Remote Files: ", remoteFiles);

      differences = compareFileMaps(localFiles, remoteFiles);
      console.log("Differences in Files: ", differences);
    } catch (error) {
      console.error("Error:", error);
    }

    return differences;
  }
}
