import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { getFullPaths, getRelativePath, normalizePath } from "./filePathUtils";
import { ConnectionManager } from "../../managers/ConnectionManager";
import pLimit = require("p-limit");
import { BaseNodeType } from "../BaseNode";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";
import { SSHClient } from "../../services/SSHClient";
import { LOG_FLAGS, logErrorMessage } from "../../managers/LogManager";
import { shouldIgnore } from "../shouldIgnore";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

async function createRemoteDirectories(fileEntry: ComparisonFileNode) {
  const directoriesToCreate: Set<string> = new Set();
  const filePaths: { localPath: string; remotePath: string }[] = [];

  const traverseNode = async (node: ComparisonFileNode) => {
    const { localPath, remotePath } = await getFullPaths(node);
    
    if(shouldIgnore(remotePath)) {
      return;
    }

    if (node.isDirectory()) {
      let hasChildDirectories = false;

      for (const child of node.listChildren()) {
        if (child.isDirectory()) {
          hasChildDirectories = true;
        }
        await traverseNode(child); // Recursively process children
      }

      // Add to the list if it's a directory with no children or no children that are directories
      if (!hasChildDirectories && node.status !== ComparisonStatus.removed) {
        directoriesToCreate.add(remotePath);
      }
    } else if(node.status !== ComparisonStatus.removed) {
      filePaths.push({ localPath, remotePath }); // Add file to the list
    }
  };

  await traverseNode(fileEntry);

  return { directoriesToCreate: Array.from(directoriesToCreate), filePaths };
}

async function uploadFilesWithLimit(sftpClient: SFTPClient, filePaths: { localPath: string; remotePath: string }[]) {
  const promises = filePaths.map((file) => limit(() => sftpClient.uploadFile(file.localPath, file.remotePath)));
  await Promise.all(promises);
}

export async function uploadDirectory(rootEntry: ComparisonFileNode) {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      // Step 1: Collect remote directories and  file paths
      const { directoriesToCreate, filePaths } = await createRemoteDirectories(rootEntry);

      // Step 2: Create directories via SSH command
      await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
        await sshClient.createDirectoriesBatch(directoriesToCreate);
      });

      // Step 3: Upload files with concurrency limits
      await uploadFilesWithLimit(sftpClient, filePaths);
    }, `Upload Dir ${rootEntry.relativePath}`);
  } catch (error: any) {
    logErrorMessage(`Failed to upload directory: ${error.message}`, LOG_FLAGS.ALL);
  }
}

async function createLocalDirectories(node: ComparisonFileNode) {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);
  const filePaths: { remotePath: string; localPath: string }[] = [];

  const createDir = async (node: ComparisonFileNode) => {
    const { localPath, remotePath } = await getFullPaths(node);

    if(shouldIgnore(remotePath)) {
      return;
    }

    if (node.isDirectory()) {

      let remoteEntries: Array<{ name: string; type: string; size: number; modifyTime: number }>;
      try {
        remoteEntries = await connectionManager.doSFTPOperation(
          async (sftpClient: SFTPClient) =>
            sftpClient.listFiles(remotePath)
        );
        await fs.promises.mkdir(localPath, { recursive: true });
      } catch (err: any) {
        // only skip permission errors
        if (err.code === "EACCES" || /permission denied/i.test(err.message)) {
          logErrorMessage(
            `Skipping remote directory due to permissions: ${remotePath}`,
            LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
          );
          return;
        }
        // rethrow unexpected SFTP errors
        throw err;
      }

      for (const remoteEntry of remoteEntries) {
        const fullLocalPath = normalizePath(path.join(localPath, remoteEntry.name));
        const childEntry = new ComparisonFileNode(
          remoteEntry.name,
          remoteEntry.type === "d" ? BaseNodeType.directory : BaseNodeType.file,
          remoteEntry.size,
          new Date(remoteEntry.modifyTime * 1000),
          getRelativePath(fullLocalPath),
          ComparisonStatus.unchanged
        );
        await createDir(childEntry);
      }
    } else {
      filePaths.push({ localPath, remotePath });
    }
  };

  await createDir(node);
  return filePaths;
}

async function downloadFilesWithLimit(sftpClient: SFTPClient, filePaths: { remotePath: string; localPath: string }[]) {
  const promises = filePaths.map((file) => limit(() => sftpClient.downloadFile(file.remotePath, file.localPath)));
  await Promise.all(promises);
}

export async function downloadDirectory(remoteEntry: ComparisonFileNode) {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      // Step 1: Create local directories and collect file paths
      const filePaths = await createLocalDirectories(remoteEntry);

      // Step 2: Download files with concurrency limits
      await downloadFilesWithLimit(sftpClient, filePaths);
    }, `Download Dir ${remoteEntry.relativePath}`);
  } catch (error: any) {
    logErrorMessage(`Failed to download directory: ${error.message}`, LOG_FLAGS.ALL);
  }
}
