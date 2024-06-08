import * as fs from "fs/promises";
import * as path from "path";
import {
  FileEntry,
  FileEntrySource,
  FileEntryType,
} from "../../utilities/FileEntry";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import pLimit = require("p-limit");
import { ConnectionManager } from "../../services/ConnectionManager";
import { SFTPClient } from "../../services/SFTPClient";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

export async function listRemoteFilesRecursive(
  remoteDir: string,
  fileGlob?: any,
): Promise<FileEntry> {
  console.log(`Listing remote ${remoteDir} recursively...`);
  const workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfiguration.configuration) {
    throw new Error("Please configure the plugin.");
  }

  const listDirectory = async (
    sftpClient: SFTPClient,
    dir: string,
  ): Promise<FileEntry> => {
    // console.log(`Listing Dir ${dir}`);
    const normalizedDir = dir.replace(/\\/g, "/");
    const dirStat = await sftpClient.getClient().stat(normalizedDir);
    const fileObjects = await sftpClient
      .getClient()
      .list(normalizedDir, fileGlob);
    const directoryContents: FileEntry = new FileEntry(
      path.basename(normalizedDir),
      FileEntryType.directory,
      dirStat.size,
      new Date(dirStat.modifyTime * 1000),
      FileEntrySource.remote,
      normalizedDir,
    );

    const promises = fileObjects.map((file) =>
      limit(async () => {
        // console.log(`Listing File ${file.name}`);
        const filePath = path
          .join(normalizedDir, file.name)
          .replace(/\\/g, "/");
        const stats = await sftpClient.getClient().stat(filePath);

        if (file.type === "d") {
          const subfiles = await listDirectory(sftpClient, filePath);
          directoryContents.addChild(subfiles);
        } else {
          directoryContents.addChild(
            new FileEntry(
              file.name,
              FileEntryType.file,
              stats.size,
              new Date(stats.modifyTime * 1000),
              FileEntrySource.remote,
              filePath,
            ),
          );
        }
      }),
    );

    await Promise.all(promises);
    return directoryContents;
  };

  try {
    const connectionManager = ConnectionManager.getInstance(
      workspaceConfiguration.configuration,
    );
    return await connectionManager.doSFTPOperation(
      async (sftpClient: SFTPClient) => {
        return await listDirectory(sftpClient, remoteDir);
      },
    );
  } catch (error) {
    console.error("Recursive remote listing failed:", error);
    return new FileEntry(
      "",
      FileEntryType.directory,
      0,
      new Date(),
      FileEntrySource.remote,
      "",
    );
  }
}

export async function listLocalFilesRecursive(
  localDir: string,
): Promise<FileEntry> {
  console.log(`Listing local ${localDir} recursively...`);

  const rootEntry = new FileEntry(
    path.basename(localDir),
    FileEntryType.directory,
    (await fs.stat(localDir)).size,
    (await fs.stat(localDir)).mtime,
    FileEntrySource.local,
    path.normalize(localDir),
  );

  const stack = [rootEntry];

  while (stack.length > 0) {
    const currentEntry = stack.pop();
    if (!currentEntry) {
      continue;
    }

    const currentDir = currentEntry.fullPath;
    const files = await fs.readdir(currentDir, { withFileTypes: true });

    const promises = files.map((file) =>
      limit(async () => {
        const filePath = path.join(currentDir, file.name);
        const normalizedFilePath = path.normalize(filePath);

        const stats = await fs.stat(normalizedFilePath);

        if (file.isDirectory()) {
          const dirEntry = new FileEntry(
            file.name,
            FileEntryType.directory,
            stats.size,
            stats.mtime,
            FileEntrySource.local,
            normalizedFilePath,
          );
          currentEntry.addChild(dirEntry);
          stack.push(dirEntry); // Add directory to stack for further processing
        } else {
          currentEntry.addChild(
            new FileEntry(
              file.name,
              FileEntryType.file,
              stats.size,
              stats.mtime,
              FileEntrySource.local,
              normalizedFilePath,
            ),
          );
        }
      }),
    );

    await Promise.all(promises); // Wait for all current directory operations to complete
  }

  return rootEntry;
}
