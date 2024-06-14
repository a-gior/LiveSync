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
import { listRemoteFilesRecursive } from "./fileListing";
import { ConnectionManager } from "../../services/ConnectionManager";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import pLimit = require("p-limit");

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
        console.log(`MKDIR Directory: ${remotePath}`);
        await sftpClient.getClient().mkdir(remotePath, true);
      } else {
        const parentDirPath = path.dirname(remotePath);
        if (lastParentDir !== parentDirPath) {
          lastParentDir = parentDirPath;
          console.log(`MKDIR Directory(parent): ${parentDirPath}`);
          await sftpClient.getClient().mkdir(parentDirPath, true);
        }
        filePaths.push({ localPath: entry.fullPath, remotePath });
      }
    } else {
      if (entry.isDirectory()) {
        console.log(`MKDIR Directory: ${remotePath}`);
        await sftpClient.getClient().mkdir(remotePath, true);
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
      console.log(`Uploaded ${localPath} to ${remotePath}`);
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
  const configuration =
    WorkspaceConfig.getInstance().getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      // Step 1: Create remote directories and collect file paths
      const filePaths = await createRemoteDirectories(sftpClient, rootEntry);

      // Step 2: Upload files with concurrency limits
      await uploadFilesWithLimit(sftpClient, filePaths);
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
  const configuration =
    WorkspaceConfig.getInstance().getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    await connectionManager.doSFTPOperation(async (sftpClient: SFTPClient) => {
      const remoteDir = fileEntry.fullPath;
      const localDir = baseLocalDir || getCorrespondingPath(remoteDir);
      console.log(`Downloading directory ${remoteDir} to ${localDir}`);
      if (!localDir) {
        window.showErrorMessage(`No local path found for ${remoteDir}`);
        return;
      }

      const remoteFilesEntry = await listRemoteFilesRecursive(remoteDir);

      for (const child of remoteFilesEntry.listChildren()) {
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
  const configuration =
    WorkspaceConfig.getInstance().getRemoteServerConfigured();
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
    });
  } catch (error: any) {
    console.error(`Failed to delete remote directory: ${error.message}`);
    window.showErrorMessage(
      `Failed to delete remote directory: ${error.message}`,
    );
  }
}
