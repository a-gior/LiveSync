import { workspace, window, TextDocument } from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { ConfigurationMessage } from "../../DTOs/messages/ConfigurationMessage";
import {
  FileEntry,
  FileEntryType,
  FileEntrySource,
} from "../../utilities/FileEntry";
import { getLocalPath, getRemotePath } from "./filePathUtils";
import { listRemoteFilesRecursive } from "./fileListing";
import { ConfigurationState } from "../../DTOs/states/ConfigurationState";
import { ConnectionManager } from "../../services/ConnectionManager";

export async function uploadDirectory(fileEntry: FileEntry): Promise<void> {
  const workspaceConfig: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfig.configuration) {
    window.showErrorMessage("Remote server not configured.");
    return;
  }

  const connectionManager = ConnectionManager.getInstance(
    workspaceConfig.configuration,
  );

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      if (!workspaceConfig.pairedFolders) {
        window.showErrorMessage("Paired folders not configured");
        return;
      }
      const remoteDir = getRemotePath(
        fileEntry.fullPath,
        workspaceConfig.pairedFolders,
      );
      console.log(`Uploading directory ${remoteDir}`);
      if (remoteDir === null) {
        window.showErrorMessage(
          `No remote path found for ${fileEntry.fullPath}`,
        );
        return;
      }
      await sftpClient.getClient().mkdir(remoteDir, true);

      for (const child of fileEntry.listChildren()) {
        if (child.isDirectory()) {
          await uploadDirectory(child);
        } else {
          await sftpClient
            .getClient()
            .put(child.fullPath, path.join(remoteDir, child.name));
        }
      }
    });
  } catch (error: any) {
    console.error(`Failed to upload directory: ${error.message}`);
    window.showErrorMessage(`Failed to upload directory: ${error.message}`);
  }
}

export async function downloadDirectory(
  fileEntry: FileEntry,
  baseLocalDir?: string,
): Promise<void> {
  const workspaceConfig: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfig.configuration) {
    window.showErrorMessage("Remote server not configured.");
    return;
  }

  const connectionManager = ConnectionManager.getInstance(
    workspaceConfig.configuration,
  );

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      if (!workspaceConfig.pairedFolders) {
        window.showErrorMessage("Paired folders not configured");
        return;
      }

      const remoteDir = fileEntry.fullPath;
      const localDir =
        baseLocalDir || getLocalPath(remoteDir, workspaceConfig.pairedFolders);
      console.log(`Downloading directory ${remoteDir} to ${localDir}`);
      if (!localDir) {
        window.showErrorMessage(`No local path found for ${remoteDir}`);
        return;
      }

      const remoteFilesEntry = await listRemoteFilesRecursive(remoteDir);

      for (const [, child] of remoteFilesEntry.children) {
        const childLocalPath = path.join(localDir, child.name);
        if (child.type === FileEntryType.directory) {
          await fs.promises.mkdir(childLocalPath, { recursive: true });
          await downloadDirectory(child, childLocalPath);
        } else {
          await fs.promises.mkdir(path.dirname(childLocalPath), {
            recursive: true,
          });
          await sftpClient.getClient().fastGet(child.fullPath, childLocalPath);
        }
      }
    });
  } catch (error: any) {
    console.error(`Failed to download directory: ${error.message}`);
    window.showErrorMessage(`Failed to download directory: ${error.message}`);
  }
}

export async function deleteRemoteDirectory(
  fileEntry: FileEntry,
): Promise<void> {
  const workspaceConfig: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfig.configuration) {
    window.showErrorMessage("Remote server not configured");
    return;
  }

  const connectionManager = ConnectionManager.getInstance(
    workspaceConfig.configuration,
  );

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      const remoteDir = fileEntry.fullPath.replace(/\\/g, "/");
      const children = await sftpClient.getClient().list(remoteDir);
      for (const child of children) {
        const childPath = path.join(remoteDir, child.name).replace(/\\/g, "/");
        if (child.type === "d") {
          const subDirEntry = new FileEntry(
            child.name,
            FileEntryType.directory,
            0,
            new Date(child.modifyTime * 1000),
            FileEntrySource.remote,
            childPath,
          );
          await deleteRemoteDirectory(subDirEntry);
        } else {
          await sftpClient.getClient().delete(childPath);
        }
      }
      await sftpClient.getClient().rmdir(remoteDir);
    });
  } catch (error: any) {
    console.error(`Failed to delete remote directory: ${error.message}`);
    window.showErrorMessage(
      `Failed to delete remote directory: ${error.message}`,
    );
  }
}
