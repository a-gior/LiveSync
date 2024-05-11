import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { SFTPClient } from "./SFTPClient";

class FileSystemItem {
  constructor(
    public name: string,
    public children: FileSystemItem[] = [],
  ) {}
}

export class PairedFoldersTreeDataProvider
  implements vscode.TreeDataProvider<FileSystemItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    FileSystemItem | undefined | null | void
  > = new vscode.EventEmitter<FileSystemItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    FileSystemItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  readonly workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileSystemItem): vscode.TreeItem {
    return new vscode.TreeItem(
      element.name,
      element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
  }

  async getChildren(element?: FileSystemItem): Promise<FileSystemItem[]> {
    if (!element) {
      const rootItems: FileSystemItem[] = [];
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
          rootItems.push(await this.getFilesInDirectory(localPath, remotePath));
        }
        console.log("getChildren rootItems: ", rootItems);
      }
      return rootItems;
    } else {
      // If element provided, return its children
      return element.children;
    }
  }

  private async getFilesInDirectory(
    folderPath: string,
    remotePath: string,
    isRoot: boolean = true,
  ): Promise<FileSystemItem> {
    let root;
    if (isRoot) {
      root = new FileSystemItem(
        `[local] ${path.basename(folderPath)} <=> ${path.basename(remotePath)} [remote]`,
      );
      await this.compareDirectories(folderPath, remotePath);
    } else {
      root = new FileSystemItem(`${path.basename(folderPath)}`);
    }
    try {
      const dirents = await fs.promises.readdir(folderPath, {
        withFileTypes: true,
      });
      for (const dirent of dirents) {
        const name = dirent.name;
        const fullPath = path.join(folderPath, name);
        if (dirent.isDirectory()) {
          root.children.push(
            await this.getFilesInDirectory(fullPath, remotePath, false),
          );
        } else {
          root.children.push(new FileSystemItem(name));
        }
      }

      if (isRoot && root.children.length === 0) {
        root = new FileSystemItem(
          `[local] ${path.basename(folderPath)} <=> ${path.basename(remotePath)} [remote] (EMPTY)`,
        );
      }
    } catch (error) {
      console.error(`Error reading directory: ${folderPath}`, error);
    }
    return root;
  }

  async compareDirectories(localDir: string, remoteDir: string) {
    const sftpClient = new SFTPClient();

    try {
      // Connect to the remote server
      if (this.workspaceConfiguration.configuration) {
        await sftpClient.connect(this.workspaceConfiguration.configuration);
      }

      // List files and folders in the remote directory
      const localFiles = await sftpClient.listLocalFilesRecursive(localDir);
      const remoteFiles = await sftpClient.listRemoteFilesRecursive(remoteDir);

      console.log("Local Files: ", localFiles);
      console.log("Remote Files: ", remoteFiles);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      // Disconnect from the remote server
      await sftpClient.disconnect();
    }
  }
}
