import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { generateHash } from "./hashUtils";
import { FileNodeSource } from "../FileNode";
import { SSHClient } from "../../services/SSHClient";
import { window } from "vscode";
import { ConnectionManager } from "../../managers/ConnectionManager";
import sftp from "ssh2-sftp-client";
import { shouldIgnore } from "../shouldIgnore";
import { logErrorMessage } from "../../managers/LogManager";
import { BaseNodeType } from "../BaseNode";
import JsonManager, { isFileNodeMap, JsonType } from "../../managers/JsonManager";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";

export async function downloadRemoteFile(remotePath: string, localPath: string): Promise<void> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (shouldIgnore(remotePath)) {
    return;
  }

  await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
    const dir = path.dirname(localPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await sftpClient.downloadFile(remotePath, localPath);
  }, `Download ${remotePath}`);
}

export async function uploadRemoteFile(localPath: string, remotePath: string, checkParentDirExists: boolean = true): Promise<void> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (shouldIgnore(localPath)) {
    return;
  }

  await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
    const remoteDir = path.dirname(remotePath);
    if (checkParentDirExists) {
      const dirExists = await sftpClient.pathExists(remoteDir);
      if (!dirExists) {
        await sftpClient.createDirectory(remoteDir);
      }
    }
    await sftpClient.uploadFile(localPath, remotePath);
  }, `Upload to ${remotePath}`);
}

// Compare remote file hash with stored remote hash
export async function compareRemoteFileHash(remotePath: string): Promise<boolean> {
  try {
    // Get the remote JSON entries
    const remoteFileEntriesMap = await JsonManager.getInstance().getFileEntriesMap(JsonType.REMOTE);
    if (!remoteFileEntriesMap || !isFileNodeMap(remoteFileEntriesMap)) {
      logErrorMessage(`No remote JSON found`);
      return false;
    }
    const remoteEntry = await JsonManager.findNodeByPath(remotePath, remoteFileEntriesMap);
    if (!remoteEntry) {
      logErrorMessage(`No remote FileNode found for ${remotePath}`);
      return false;
    }

    const remoteFileHash = await generateHash(remotePath, FileNodeSource.remote, BaseNodeType.file);

    return remoteEntry.hash === remoteFileHash;
  } catch (error) {
    logErrorMessage(`Error comparing remote file hash on ${remotePath}`);
    return false;
  }
}

export async function getRemoteFileContentHash(remotePath: string): Promise<string | undefined> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  const command = `sha256sum "${remotePath}" | awk '{ print $1 }'`;
  let fileHash: string | undefined;

  try {
    await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
      const hash = await sshClient.executeCommand(command);
      fileHash = hash.trim(); // Ensure any extra whitespace is removed
    }, `Getting hash of ${remotePath}`);
  } catch (err) {
    logErrorMessage(`Error getting remote file hash on \n\t${remotePath}`);
  }

  return fileHash;
}

export async function remotePathExists(remotePath: string) {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  return await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
    return await sftpClient.pathExists(remotePath);
  }, `Checking if ${remotePath} exists`);
}

export async function getRemoteFileMetadata(remotePath: string): Promise<sftp.FileStats | undefined> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  try {
    return await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      return await sftpClient.getFileStats(remotePath);
    }, `Get data from ${remotePath}`);
  } catch (err: any) {
    logErrorMessage(`Couldn't fetch metadata for remote file ${remotePath}`);
  }
}

export async function moveRemoteFile(oldRemotePath: string, newRemotePath: string): Promise<void> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (shouldIgnore(oldRemotePath)) {
    return;
  }

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      await sftpClient.moveFile(oldRemotePath, newRemotePath);
    }, `Move file from ${oldRemotePath} to ${newRemotePath}`);
  } catch (error: any) {
    logErrorMessage(`Failed to move remote file: ${error.message}`);
    window.showErrorMessage(`Failed to move remote file: ${error.message}`);
  }
}

export async function deleteRemoteFile(remotePath: string): Promise<void> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (shouldIgnore(remotePath)) {
    return;
  }

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      await sftpClient.deleteFile(remotePath);
    }, `Delete ${remotePath}`);
  } catch (error: any) {
    logErrorMessage(`Failed to delete remote file: ${error.message}`);
    window.showErrorMessage(`Failed to delete remote file: ${error.message}`);
  }
}

export async function compareFileHash(
  localPath: string,
  remotePath: string
): Promise<boolean> {
  // Compute both hashes in parallel
  const [localHash, remoteHash] = await Promise.all([
    generateHash(localPath, FileNodeSource.local, BaseNodeType.file),
    generateHash(remotePath, FileNodeSource.remote, BaseNodeType.file)
  ]);

  return localHash === remoteHash;
}