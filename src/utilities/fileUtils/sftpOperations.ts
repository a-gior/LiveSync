import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { generateHash } from "./hashUtils";
import { FileNodeSource } from "../FileNode";
import { SSHClient } from "../../services/SSHClient";
import { ConnectionManager } from "../../managers/ConnectionManager";
import sftp from "ssh2-sftp-client";
import { shouldIgnore } from "../shouldIgnore";
import { LOG_FLAGS, logErrorMessage } from "../../managers/LogManager";
import { BaseNodeType } from "../BaseNode";
import JsonManager, { isFileNodeMap, JsonType } from "../../managers/JsonManager";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";
import { pathExists, pathType } from "./filePathUtils";
import { uploadDirectory } from "./directoryOperations";
import { TreeViewManager } from "../../managers/TreeViewManager";

export async function moveRemoteFile(newLocalPath:string, oldRemotePath: string, newRemotePath: string): Promise<void> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (shouldIgnore(oldRemotePath)) {
    return;
  }

  try {

    const oldRemoteNodeExists = await pathExists(oldRemotePath, FileNodeSource.remote);
    if(!oldRemoteNodeExists) {
      const treeDataProvider = TreeViewManager.treeDataProvider;
      // If the old remote path does not exist, we need to upload the local directory
      const comparisonFileNode = await treeDataProvider.getComparisonFileNode(newLocalPath, newRemotePath);
      await uploadDirectory(comparisonFileNode);

    } else {
      // oldRemotePath exists, we can move and rename the file or directory
      await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
        await sshClient.move(oldRemotePath, newRemotePath);
      });

    }

  } catch (error: any) {
    logErrorMessage(`Failed to move remote file: ${error.message}`, LOG_FLAGS.ALL);
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
      const remoteNodeType = await pathType(remotePath, FileNodeSource.remote);

      switch(remoteNodeType) {
        case BaseNodeType.directory:
          await sftpClient.deleteDirectory(remotePath);
          break;
  
        case BaseNodeType.file:
          await sftpClient.deleteFile(remotePath);
          break;
  
        case false:
        default: 
          throw new Error(`Remote node should exist: ${remotePath}`);
          
      }
      
    }, `Delete ${remotePath}`);
  } catch (error: any) {
    logErrorMessage(`Failed to delete remote file: ${error.message}`, LOG_FLAGS.ALL);
  }
}

export async function downloadRemoteFile(remotePath: string, localPath: string): Promise<void> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (shouldIgnore(remotePath)) {
    return;
  }

  await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
    const remoteNodeType = await pathType(remotePath, FileNodeSource.remote);

    switch(remoteNodeType) {
      case BaseNodeType.directory:
        if(!await pathExists(localPath, FileNodeSource.local)) {
          await fs.promises.mkdir(localPath, { recursive: true });
        }
        break;

      case BaseNodeType.file:
        const localDir = path.dirname(localPath);
        if(!await pathExists(localDir, FileNodeSource.local)) {
          await fs.promises.mkdir(localDir, { recursive: true });
        }
        await sftpClient.downloadFile(remotePath, localPath);
        break;

      case false:
      default: 
        throw new Error(`Remote node should exist: ${localPath}`);
        
    }
  }, `Download ${remotePath}`);
}

export async function uploadRemoteFile(localPath: string, remotePath: string): Promise<void> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (shouldIgnore(localPath)) {
    return;
  }

  await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
    const localNodeType = await pathType(localPath, FileNodeSource.local);

    switch(localNodeType) {
      case BaseNodeType.directory:
        await sftpClient.createDirectory(remotePath);
        break;

      case BaseNodeType.file:
        const remoteDir = path.dirname(remotePath);
        const dirExists = await sftpClient.exists(remoteDir);
        if (!dirExists) {
          await sftpClient.createDirectory(remoteDir);
        }
        await sftpClient.uploadFile(localPath, remotePath);
        break;

      case false:
      default: 
        throw new Error(`Local node should exist: ${localPath}`);
        
    }
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

export async function remotePathType(remotePath: string) {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);
  
  return await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
    return await sftpClient.pathType(remotePath);
  }, `Checking if ${remotePath} exists`);
}