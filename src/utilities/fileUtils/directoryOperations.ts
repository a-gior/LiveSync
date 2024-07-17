import { window } from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import {
  FileEntry,
  FileEntryType,
  FileEntrySource,
} from "../../utilities/FileEntry";
import { getCorrespondingPath } from "./filePathUtils";
import { ConnectionManager } from "../../services/ConnectionManager";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import pLimit = require("p-limit");
import { LogManager } from "../../services/LogManager";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

async function createRemoteDirectories(
  sftpClient: SFTPClient,
  fileEntry: FileEntry,
) {
  let lastParentDir = "";
  const filePaths: { localPath: string; remotePath: string }[] = [];

  const createDir = async (entry: FileEntry) => {
    const remotePath =
      entry.source === FileEntrySource.local
        ? getCorrespondingPath(entry.fullPath)
        : entry.fullPath;

    if (entry.listChildren().length === 0) {
      if (entry.isDirectory()) {
        await sftpClient.getClient().mkdir(remotePath, true);
        LogManager.log(`SFTP Created Dir ${remotePath}`);
      } else {
        const parentDirPath = path.dirname(remotePath);
        if (lastParentDir !== parentDirPath) {
          lastParentDir = parentDirPath;
          await sftpClient.getClient().mkdir(parentDirPath, true);
          LogManager.log(`SFTP Created Dir ${remotePath}`);
        }
        filePaths.push({ localPath: entry.fullPath, remotePath });
      }
    } else {
      if (entry.isDirectory()) {
        for (const child of entry.listChildren()) {
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
  const uploadFile = async (localPath: string, remotePath: string) => {
    try {
      await sftpClient.getClient().fastPut(localPath, remotePath);
      LogManager.log(`SFTP Upload ${localPath} ➜ ${remotePath}`);
    } catch (err) {
      console.error(`Failed to upload ${localPath} to ${remotePath}`, err);
    }
  };

  const promises = filePaths.map((file) =>
    limit(() => uploadFile(file.localPath, file.remotePath)),
  );
  await Promise.all(promises);
}

export async function uploadDirectory(rootEntry: FileEntry) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      // Step 1: Create remote directories and collect file paths
      const filePaths = await createRemoteDirectories(sftpClient, rootEntry);

      // Step 2: Upload files with concurrency limits
      await uploadFilesWithLimit(sftpClient, filePaths);
    }, `Upload Dir ${rootEntry.fullPath}`);
  } catch (error: any) {
    console.error(`Failed to upload directory: ${error.message}`);
    window.showErrorMessage(`Failed to upload directory: ${error.message}`);
  }
}

async function createLocalDirectories(
  sftpClient: SFTPClient,
  remoteEntry: FileEntry,
) {
  const filePaths: { remotePath: string; localPath: string }[] = [];
  const createDir = async (entry: FileEntry, localBasePath: string) => {
    const localPath = path.join(localBasePath, path.basename(entry.fullPath));

    if (entry.isDirectory()) {
      await fs.promises.mkdir(localPath, { recursive: true });

      const remoteEntries = await sftpClient.getClient().list(entry.fullPath);
      for (const remoteEntry of remoteEntries) {
        const fullRemotePath = path
          .join(entry.fullPath, remoteEntry.name)
          .replace(/\\/g, "/");
        const childEntry = new FileEntry(
          remoteEntry.name,
          remoteEntry.type === "d"
            ? FileEntryType.directory
            : FileEntryType.file,
          0,
          new Date(),
          FileEntrySource.remote,
          fullRemotePath,
        );
        await createDir(childEntry, localPath);
      }
    } else {
      filePaths.push({ remotePath: entry.fullPath, localPath });
    }
  };

  await createDir(remoteEntry, remoteEntry.fullPath);
  return filePaths;
}

async function downloadFilesWithLimit(
  sftpClient: SFTPClient,
  filePaths: { remotePath: string; localPath: string }[],
) {
  const downloadFile = async (remotePath: string, localPath: string) => {
    try {
      await sftpClient.getClient().fastGet(remotePath, localPath);
    } catch (err) {
      console.error(`Failed to download ${remotePath} to ${localPath}`, err);
    }
  };

  const promises = filePaths.map((file) =>
    limit(() => downloadFile(file.remotePath, file.localPath)),
  );
  await Promise.all(promises);
}

export async function downloadDirectory(remoteEntry: FileEntry) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      // Step 1: Create local directories and collect file paths
      const filePaths = await createLocalDirectories(sftpClient, remoteEntry);

      // Step 2: Download files with concurrency limits
      await downloadFilesWithLimit(sftpClient, filePaths);
    }, `Download Dir ${remoteEntry.fullPath}`);
  } catch (error: any) {
    console.error(`Failed to download directory: ${error.message}`);
    window.showErrorMessage(`Failed to download directory: ${error.message}`);
  }
}

export async function deleteRemoteDirectory(
  fileEntry: FileEntry,
): Promise<void> {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

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
    }, `Delete Dir ${fileEntry.fullPath}`);
  } catch (error: any) {
    console.error(`Failed to delete remote directory: ${error.message}`);
    window.showErrorMessage(
      `Failed to delete remote directory: ${error.message}`,
    );
  }
}
