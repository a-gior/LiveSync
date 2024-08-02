import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { generateHash } from "./hashUtils";
import { loadFromFile } from "./fileOperations";
import { REMOTE_FILES_PATH } from "../constants";
import { FileNodeSource, FileNodeType } from "../FileNode";
import { SSHClient } from "../../services/SSHClient";
import { window } from "vscode";
import { ConnectionManager } from "../../services/ConnectionManager";
import sftp from "ssh2-sftp-client";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import { shouldIgnore } from "../shouldIgnore";
import { logErrorMessage, logInfoMessage } from "../../services/LogManager";

export async function downloadRemoteFile(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
  localTmpPath: string,
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance(configuration);

  if (shouldIgnore(remotePath)) {
    return;
  }

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      const dir = path.dirname(localTmpPath);
      await fs.promises.mkdir(dir, { recursive: true });
      await sftpClient.getClient().fastGet(remotePath, localTmpPath);
    }, `Download ${remotePath}`);
  } catch (error: any) {
    logErrorMessage(`Failed to download file: ${error.message}`);
  }
}

export async function uploadFile(
  localPath: string,
  remotePath: string,
  checkParentDirExists: boolean = true,
): Promise<void> {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  if (shouldIgnore(localPath)) {
    return;
  }

  try {
    await connectionManager
      .doSFTPOperation(async (sftpClient: SFTPClient) => {
        const remoteDir = path.dirname(remotePath);
        if (checkParentDirExists) {
          const dirExists = await sftpClient.getClient().exists(remoteDir);
          if (!dirExists) {
            await sftpClient.getClient().mkdir(remoteDir, true);
          }
        }
        await sftpClient.getClient().fastPut(localPath, remotePath);
      }, `Upload to ${remotePath}`)
      .then(() => {
        logInfoMessage(`File ${localPath} uploaded to ${remotePath}`);
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
      FileNodeSource.remote,
      FileNodeType.file,
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

export async function getRemoteFileContentHash(
  remotePath: string,
): Promise<string | undefined> {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  const command = `sha256sum "${remotePath}" | awk '{ print $1 }'`;
  let fileHash: string | undefined;

  try {
    await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
      const hash = await sshClient.executeCommand(command);
      fileHash = hash.trim(); // Ensure any extra whitespace is removed
    }, `Get remote hash of ${remotePath}`);
  } catch (err) {
    window.showErrorMessage("Error getting remote file hash");
    console.error(
      `Error getting remote file hash on \n\t${remotePath} \nwith command \n\t${command}`,
    );
  }

  return fileHash;
}

export async function remotePathExists(remotePath: string) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
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
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
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

  if (shouldIgnore(oldRemotePath)) {
    return;
  }

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      await sftpClient.getClient().rename(oldRemotePath, newRemotePath);
    }, `Move file from ${oldRemotePath} to ${newRemotePath}`);
  } catch (error: any) {
    console.error(`Failed to move remote file: ${error.message}`);
    window.showErrorMessage(`Failed to move remote file: ${error.message}`);
  }
}

export async function deleteRemoteFile(remotePath: string): Promise<void> {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  if (shouldIgnore(remotePath)) {
    return;
  }

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      await sftpClient.getClient().delete(remotePath);
    }, `Delete ${remotePath}`);
  } catch (error: any) {
    console.error(`Failed to delete remote file: ${error.message}`);
    window.showErrorMessage(`Failed to delete remote file: ${error.message}`);
  }
}
