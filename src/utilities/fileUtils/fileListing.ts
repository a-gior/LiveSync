import * as fs from "fs/promises";
import * as path from "path";
import {
  FileEntry,
  FileEntrySource,
  FileEntryType,
} from "../../utilities/FileEntry";
import pLimit = require("p-limit");
import { ConnectionManager } from "../../services/ConnectionManager";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import { LogManager } from "../../services/LogManager";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

export async function listRemoteFilesRecursive(
  remoteDir: string,
): Promise<FileEntry> {
  console.log(`Listing remote ${remoteDir} recursively...`);

  const configuration =
    WorkspaceConfig.getInstance().getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    return await connectionManager.doSSHOperation(async (sshClient) => {
      /**
       * Commands to also get hash on the following line for files
       * find /home/centos/test-workspace/ -exec sh -c 'if [ -d "$1" ]; then stat --format="%n,%s,%Y,%F," "$1"; else stat --format="%n,%s,%Y,%F" "$1" && sha256sum "$1" | awk "{printf \\"%s\\", \$1}"; fi' sh {} \;
       */
      const command = `find "${remoteDir}" -exec stat --format='%n,%s,%Y,%F' {} \\;`;
      const output = await sshClient.executeCommand(command);

      const lines = output.trim().split("\n");

      // Extract the first line to create the rootEntry
      const [rootFullPath, rootSize, rootModifyTime] = lines[0].split(",");
      const rootEntry = new FileEntry(
        path.basename(rootFullPath),
        FileEntryType.directory,
        parseInt(rootSize, 10),
        new Date(parseInt(rootModifyTime, 10) * 1000),
        FileEntrySource.remote,
        rootFullPath,
      );

      // Process each line to build the tree
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const [fullPath, size, modifyTime, type] = line.split(",");
        LogManager.log(`List ${fullPath}`);
        const entryType =
          type === "directory" ? FileEntryType.directory : FileEntryType.file;

        const newEntry = new FileEntry(
          path.basename(fullPath),
          entryType,
          parseInt(size, 10),
          new Date(parseInt(modifyTime, 10) * 1000),
          FileEntrySource.remote,
          fullPath,
        );

        const relativePath = path.relative(rootFullPath, fullPath);
        const pathParts = relativePath.split(path.sep);

        let currentEntry = rootEntry;

        for (const part of pathParts) {
          if (currentEntry.children.has(part)) {
            currentEntry = currentEntry.children.get(part)!;
          } else {
            currentEntry.addChild(newEntry);
            break;
          }
        }
      }

      console.log("Root Entry: ", rootEntry);
      return rootEntry;
    }, `Listing files from ${remoteDir}`);
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
