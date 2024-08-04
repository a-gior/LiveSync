import * as fs from "fs/promises";
import * as path from "path";
import { FileNode, FileNodeSource } from "../FileNode";
import pLimit = require("p-limit");
import { ConnectionManager } from "../../services/ConnectionManager";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import { LogManager } from "../../services/LogManager";
import { shouldIgnore } from "../shouldIgnore";
import { generateHash2, getLocalFileHash } from "./hashUtils";
import { StatusBarManager } from "../../services/StatusBarManager";
import { BaseNodeType } from "../BaseNode";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

export async function listRemoteFilesRecursive(
  remoteDir: string,
): Promise<FileNode> {
  console.log(`Listing remote ${remoteDir} recursively...`);

  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  try {
    return await connectionManager.doSSHOperation(async (sshClient) => {
      /**
       * Commands to get the list of paths for folders and files
       * find "${remoteDir}" -exec stat --format='%n,%s,%Y,%F' {} \\;
       * Commands to also get hash on the following line for files
       * find "${remoteDir}" -exec sh -c 'if [ -d "$1" ]; then stat --format="%n,%s,%Y,%F," "$1"; else stat --format="%n,%s,%Y,%F" "$1" && sha256sum "$1" | awk "{printf \\"%s\\\n\\", \\$1}"; fi' sh {} \\;
       */
      const command = `find "${remoteDir}" -exec sh -c 'if [ -d "$1" ]; then stat --format="%n,%s,%Y,%F," "$1"; else stat --format="%n,%s,%Y,%F" "$1" && sha256sum "$1" | awk "{printf \\"%s\\\\n\\", \\\$1}"; fi' sh {} \\;`;
      const output = await sshClient.executeCommand(command);

      const lines = output.trim().split("\n");

      // Extract the first line to create the rootEntry
      const [rootFullPath, rootSize, rootModifyTime] = lines[0].split(",");
      const rootEntry = new FileNode(
        path.basename(rootFullPath),
        BaseNodeType.directory,
        parseInt(rootSize, 10),
        new Date(parseInt(rootModifyTime, 10) * 1000),
        rootFullPath,
        FileNodeSource.remote
      );

      // Process each line to build the tree
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Skip lines with only hash (result of skipping lines when ignored)
        if (line.split(",").length <= 1) {
          console.error("Skipping line: ", line);
          continue;
        }
        const [fullPath, size, modifyTime, type] = line.split(",");

        const entryType =
          type === "directory" ? BaseNodeType.directory : BaseNodeType.file;

        if (shouldIgnore(fullPath)) {
          continue;
        }
        LogManager.log(`[${i}] List ${fullPath}`);

        const newEntry = new FileNode(
          path.basename(fullPath),
          entryType,
          parseInt(size, 10),
          new Date(parseInt(modifyTime, 10) * 1000),
          fullPath,
          FileNodeSource.remote,
        );

        let hash = "";
        if (entryType === BaseNodeType.file) {
          // Get the hash from the next line if it's a file
          hash = lines[++i];
        }
        newEntry.hash = generateHash2(fullPath, entryType, hash);

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
    return new FileNode(
      "",
      BaseNodeType.directory,
      0,
      new Date(),
      "",
      FileNodeSource.remote,
    );
  }
}

export async function listLocalFilesRecursive(
  localDir: string,
): Promise<FileNode> {
  console.log(`Listing local ${localDir} recursively...`);
  StatusBarManager.showMessage(
    `Listing files of ${localDir}`,
    "",
    "",
    0,
    "sync~spin",
    true,
  );

  const rootEntry = new FileNode(
    path.basename(localDir),
    BaseNodeType.directory,
    (await fs.stat(localDir)).size,
    (await fs.stat(localDir)).mtime,
    path.normalize(localDir),
    FileNodeSource.local,
  );

  const stack = [rootEntry];

  while (stack.length > 0) {
    const currentEntry = stack.pop();
    if (!currentEntry) {
      continue;
    }

    if (shouldIgnore(currentEntry.fullPath)) {
      continue;
    }

    const currentDir = currentEntry.fullPath;
    const files = await fs.readdir(currentDir, { withFileTypes: true });

    const promises = files.map((file) =>
      limit(async () => {
        const filePath = path.join(currentDir, file.name);
        const normalizedFilePath = path.normalize(filePath);

        if (shouldIgnore(normalizedFilePath)) {
          return;
        }

        const stats = await fs.stat(normalizedFilePath);
        const entryType = file.isDirectory()
          ? BaseNodeType.directory
          : BaseNodeType.file;

        const newEntry = new FileNode(
          file.name,
          entryType,
          stats.size,
          stats.mtime,
          normalizedFilePath,
          FileNodeSource.local,
        );
        const hashContent = await getLocalFileHash(normalizedFilePath);
        newEntry.hash = generateHash2(
          normalizedFilePath,
          entryType,
          hashContent,
        );

        if (file.isDirectory()) {
          currentEntry.addChild(newEntry);
          stack.push(newEntry); // Add directory to stack for further processing
        } else {
          currentEntry.addChild(newEntry);
        }
      }),
    );

    await Promise.all(promises); // Wait for all current directory operations to complete
  }

  return rootEntry;
}
