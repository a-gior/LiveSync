import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { ConfigurationMessage } from "../../DTOs/messages/ConfigurationMessage";
import { generateHash } from "./hashUtils";
import { loadFromFile } from "./fileOperations";
import { REMOTE_FILES_PATH } from "../constants";
import { uploadDirectory } from "./directoryOperations";
import { FileEntrySource, FileEntryType } from "../FileEntry";
import { SSHClient } from "../../services/SSHClient";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { window } from "vscode";
import { ConnectionManager } from "../../services/ConnectionManager";
import { ConfigurationState } from "../../DTOs/states/ConfigurationState";
import sftp from "ssh2-sftp-client";

export async function downloadRemoteFile(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
  localTmpPath: string,
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      const dir = path.dirname(localTmpPath);
      await fs.promises.mkdir(dir, { recursive: true });
      await sftpClient.getClient().fastGet(remotePath, localTmpPath);
    });
  } catch (error: any) {
    console.error(`Failed to download file: ${error.message}`);
    window.showErrorMessage(`Failed to download file: ${error.message}`);
  }
}

export async function uploadFile(
  configuration: ConfigurationMessage["configuration"],
  localPath: string,
  remotePath: string,
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      const remoteDir = path.dirname(remotePath);
      const dirExists = await sftpClient.getClient().exists(remoteDir);
      if (!dirExists) {
        await sftpClient.getClient().mkdir(remoteDir, true);
      }
      await sftpClient.getClient().put(localPath, remotePath);
    });
  } catch (error: any) {
    console.error(`Failed to upload file: ${error.message}`);
    window.showErrorMessage(`Failed to upload file: ${error.message}`);
  }
}

export async function compareRemoteFileHash(
  remotePath: string,
): Promise<boolean> {
  try {
    const remoteFileHash = generateHash(
      remotePath,
      FileEntrySource.remote,
      FileEntryType.file,
    );

    const storedRemoteFiles = await loadFromFile<{ [key: string]: any }>(
      REMOTE_FILES_PATH,
    );
    const storedHash = storedRemoteFiles[remotePath]?.hash;

    return remoteFileHash === storedHash;
  } catch (error) {
    console.error("Error comparing remote file hash:", error);
    return false;
  }
}

export async function getRemoteHash(
  remotePath: string,
): Promise<string | undefined> {
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();

  if (!workspaceConfig["configuration"]) {
    window.showErrorMessage("Remote server not configured");
    return;
  }

  const connectionManager = ConnectionManager.getInstance(
    workspaceConfig["configuration"],
  );
  const command = `sha256sum ${remotePath} | awk '{ print $1 }'`;
  let fileHash: string | undefined;

  try {
    await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
      const hash = await sshClient.executeCommand(command);
      fileHash = hash.trim(); // Ensure any extra whitespace is removed
    });
  } catch (err) {
    window.showErrorMessage("Error getting remote file hash");
    console.log("Error: ", err);
  }

  return fileHash;
}

export async function remotePathExists(remotePath: string) {
  const workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfiguration.configuration) {
    throw new Error("Please configure the plugin.");
  }

  try {
    const connectionManager = ConnectionManager.getInstance(
      workspaceConfiguration.configuration,
    );
    return await connectionManager.doSFTPOperation(
      async (sftpClient: SFTPClient) => {
        return await sftpClient.pathExists(remotePath);
      },
    );
  } catch (error) {
    console.error(`Error while checking if path exists: ${remotePath}`, error);
  }
}

export async function getRemoteFileMetadata(
  remotePath: string,
): Promise<sftp.FileStats | undefined> {
  const workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfiguration.configuration) {
    throw new Error("Please configure the plugin.");
  }

  try {
    const connectionManager = ConnectionManager.getInstance(
      workspaceConfiguration.configuration,
    );
    return await connectionManager.doSFTPOperation(
      async (sftpClient: SFTPClient) => {
        return await sftpClient.getClient().stat(remotePath);
      },
    );
  } catch (err: any) {
    console.error(`Couldn't fetch metadata for remote file ${remotePath}`);
  }
}

export async function moveRemoteFile(
  configuration: ConfigurationMessage["configuration"],
  oldRemotePath: string,
  newRemotePath: string,
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      await sftpClient.getClient().rename(oldRemotePath, newRemotePath);
    });
  } catch (error: any) {
    console.error(`Failed to move remote file: ${error.message}`);
    window.showErrorMessage(`Failed to move remote file: ${error.message}`);
  }
}

export async function deleteRemoteFile(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      await sftpClient.getClient().delete(remotePath);
    });
  } catch (error: any) {
    console.error(`Failed to delete remote file: ${error.message}`);
    window.showErrorMessage(`Failed to delete remote file: ${error.message}`);
  }
}
