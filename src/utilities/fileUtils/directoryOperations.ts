import { window } from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { FileNode, FileNodeSource } from "../FileNode";
import { getFullPaths, getRootFolderName } from "./filePathUtils";
import { ConnectionManager } from "../../services/ConnectionManager";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import pLimit = require("p-limit");
import { LogManager } from "../../services/LogManager";
import { BaseNodeType } from "../BaseNode";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

async function createRemoteDirectories(
  sftpClient: SFTPClient,
  fileEntry: ComparisonFileNode,
) {
  let lastParentDir = "";
  const filePaths: { localPath: string; remotePath: string }[] = [];

  const createDir = async (node: ComparisonFileNode) => {
    const { localPath, remotePath } = await getFullPaths(node);
    if (!remotePath || !localPath) {
      throw new Error(
        `Couldnt find localPath or remotePath for ${node.relativePath}`,
      );
    }

    if (node.listChildren().length === 0) {
      if (node.isDirectory()) {
        await sftpClient.createDirectory(remotePath);
        LogManager.log(`SFTP Created Dir ${remotePath}`);
      } else {
        const parentDirPath = path.dirname(remotePath);
        if (lastParentDir !== parentDirPath) {
          lastParentDir = parentDirPath;
          await sftpClient.createDirectory(parentDirPath);
          LogManager.log(`SFTP Created Dir ${remotePath}`);
        }
        filePaths.push({ localPath, remotePath });
      }
    } else {
      if (node.isDirectory()) {
        for (const child of node.listChildren()) {
          await createDir(child);
        }
      }
    }
  };

  await createDir(fileEntry);
  return filePaths;
}

async function uploadFilesWithLimit(
  sftpClient: SFTPClient,
  filePaths: { localPath: string; remotePath: string }[],
) {
  const promises = filePaths.map((file) =>
    limit(() => sftpClient.uploadFile(file.localPath, file.remotePath)),
  );
  await Promise.all(promises);
}

export async function uploadDirectory(rootEntry: ComparisonFileNode) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      // Step 1: Create remote directories and collect file paths
      const filePaths = await createRemoteDirectories(sftpClient, rootEntry);

      // Step 2: Upload files with concurrency limits
      await uploadFilesWithLimit(sftpClient, filePaths);
    }, `Upload Dir ${rootEntry.relativePath}`);
  } catch (error: any) {
    console.error(`Failed to upload directory: ${error.message}`);
    window.showErrorMessage(`Failed to upload directory: ${error.message}`);
  }
}

async function createLocalDirectories(node: ComparisonFileNode) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);
  const filePaths: { remotePath: string; localPath: string }[] = [];

  const createDir = async (node: ComparisonFileNode) => {
    const { localPath, remotePath } = await getFullPaths(node);
    if (!remotePath || !localPath) {
      throw new Error(
        `Couldnt find localPath or remotePath for ${node.relativePath}`,
      );
    }

    if (node.isDirectory()) {
      await fs.promises.mkdir(localPath, { recursive: true });

      const remoteEntries = await connectionManager.doSFTPOperation(
        async (sftpClient: SFTPClient) => {
          return await sftpClient.listFiles(remotePath);
        },
      );

      for (const remoteEntry of remoteEntries) {
        const remoteEntryPath = path.join(localPath, remoteEntry.name);
        const childEntry = new ComparisonFileNode(
          remoteEntry.name,
          await getRootFolderName(remoteEntryPath),
          remoteEntry.type === "d" ? BaseNodeType.directory : BaseNodeType.file,
          remoteEntry.size,
          new Date(remoteEntry.modifyTime * 1000),
          remoteEntryPath,
          ComparisonStatus.unchanged,
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

async function downloadFilesWithLimit(
  sftpClient: SFTPClient,
  filePaths: { remotePath: string; localPath: string }[],
) {
  const promises = filePaths.map((file) =>
    limit(() => sftpClient.downloadFile(file.remotePath, file.localPath)),
  );
  await Promise.all(promises);
}

export async function downloadDirectory(remoteEntry: ComparisonFileNode) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      // Step 1: Create local directories and collect file paths
      const filePaths = await createLocalDirectories(remoteEntry);
      console.log(`FilePaths: `, filePaths);

      // Step 2: Download files with concurrency limits
      await downloadFilesWithLimit(sftpClient, filePaths);
    }, `Download Dir ${remoteEntry.relativePath}`);
  } catch (error: any) {
    console.error(`Failed to download directory: ${error.message}`);
    window.showErrorMessage(`Failed to download directory: ${error.message}`);
  }
}

export async function deleteRemoteDirectory(
  fileEntry: FileNode,
): Promise<void> {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      const remoteDir = fileEntry.fullPath.replace(/\\/g, "/");
      const children = await sftpClient.listFiles(remoteDir);
      for (const child of children) {
        const childPath = path.join(remoteDir, child.name).replace(/\\/g, "/");
        if (child.type === "d") {
          const subDirEntry = new FileNode(
            child.name,
            await getRootFolderName(childPath),
            BaseNodeType.directory,
            0,
            new Date(child.modifyTime * 1000),
            childPath,
            FileNodeSource.remote,
          );
          await deleteRemoteDirectory(subDirEntry);
        } else {
          await sftpClient.deleteFile(childPath);
        }
      }
      await sftpClient.deleteDirectory(remoteDir);
    }, `Delete Dir ${fileEntry.fullPath}`);
  } catch (error: any) {
    console.error(`Failed to delete remote directory: ${error.message}`);
    window.showErrorMessage(
      `Failed to delete remote directory: ${error.message}`,
    );
  }
}
