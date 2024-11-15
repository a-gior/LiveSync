import * as fs from "fs/promises";
import * as path from "path";
import { FileNode, FileNodeSource } from "../FileNode";
import pLimit = require("p-limit");
import { ConnectionManager } from "../../services/ConnectionManager";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import { LOG_FLAGS, logErrorMessage } from "../../services/LogManager";
import { shouldIgnore } from "../shouldIgnore";
import { generateHash } from "./hashUtils";
import { StatusBarManager } from "../../services/StatusBarManager";
import { BaseNodeType } from "../BaseNode";
import { getRootFolderName, pathExists } from "./filePathUtils";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

export async function listRemoteFilesRecursive(
  remoteDir: string,
): Promise<FileNode | undefined> {
  console.log(`Listing remote ${remoteDir} recursively...`);

  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  let lastBufferedFile: FileNode | undefined; // Always buffer the last file entry for the hash

  if (!(await pathExists(remoteDir, FileNodeSource.remote))) {
    logErrorMessage(
      `<listRemoteFilesRecursive> Could not find remotely the specified file/folder at ${remoteDir}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
    );
    return undefined;
  }

  try {
    return await connectionManager.doSSHOperation(async (sshClient) => {
      const command = `find "${remoteDir}" -exec sh -c 'if [ -d "$1" ]; then stat --format="%n,%s,%Y,%F," "$1"; else stat --format="%n,%s,%Y,%F" "$1" && sha256sum "$1" | awk "{printf \\"%s\\\\n\\", \\\$1}"; fi' sh {} \\;`;

      let rootEntry: FileNode | undefined;
      let currentEntry: FileNode | undefined;

      await sshClient.executeCommand(command, async (data?: string) => {
        if (!data) {
          return;
        }

        const lines = data.trim().split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          const splitLine = line.split(",");
          if (splitLine.length === 1) {
            // It's a hash, apply it to the last buffered file
            if (lastBufferedFile) {
              lastBufferedFile.hash = await generateHash(
                lastBufferedFile.fullPath,
                FileNodeSource.remote,
                BaseNodeType.file,
                line,
              );
              lastBufferedFile = undefined; // Clear the buffer after applying the hash
            } else {
              // console.warn(`Unexpected hash with no buffered file. It may be due to a previously ignored or skipped file. Hash: ${line}`);
            }
            continue; // Move on to the next line
          }

          // Process the metadata line
          const [fullPath, size, modifyTime, type] = splitLine;
          const entryType =
            type === "directory" ? BaseNodeType.directory : BaseNodeType.file;

          if (shouldIgnore(fullPath)) {
            continue;
          }

          const newEntry = new FileNode(
            path.basename(fullPath),
            await getRootFolderName(fullPath),
            entryType,
            parseInt(size, 10),
            new Date(parseInt(modifyTime, 10) * 1000),
            fullPath,
            FileNodeSource.remote,
          );

          // Buffer the file if it's not a directory (we'll process its hash when it appears)
          if (entryType === BaseNodeType.file) {
            lastBufferedFile = newEntry;
          }

          // Handle the root entry or current entry for directories
          if (!rootEntry) {
            rootEntry = newEntry;
            currentEntry = rootEntry;
          } else {
            const relativePath = path.relative(rootEntry.fullPath, fullPath);
            const pathParts = relativePath.split(path.sep);

            let tempEntry = currentEntry;

            for (const part of pathParts) {
              if (tempEntry!.children.has(part)) {
                tempEntry = tempEntry!.children.get(part)!;
              } else {
                tempEntry!.addChild(newEntry);
                break;
              }
            }
          }
        }
      });

      if (!rootEntry) {
        throw new Error(
          `<listRemoteFilesRecursive> Could not build the FileNode for the file/folder at ${remoteDir}`,
        );
      }

      return rootEntry;
    }, `Listing files from ${remoteDir}`);
  } catch (error) {
    console.error("Recursive remote listing failed:", error);
    return new FileNode(
      "",
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
): Promise<FileNode | undefined> {
  console.log(`Listing local ${localDir} recursively...`);
  StatusBarManager.showMessage(
    `Listing files of ${localDir}`,
    "",
    "",
    0,
    "sync~spin",
    true,
  );

  const nodeType = await pathExists(localDir, FileNodeSource.local);
  if (!nodeType) {
    logErrorMessage(
      `Could not find locally the specified file/folder at ${localDir}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
    );
    return undefined;
  }

  const rootEntry = new FileNode(
    path.basename(localDir),
    await getRootFolderName(path.normalize(localDir)),
    nodeType,
    (await fs.stat(localDir)).size,
    (await fs.stat(localDir)).mtime,
    path.normalize(localDir),
    FileNodeSource.local,
  );

  rootEntry.hash = await generateHash(
    path.normalize(localDir),
    FileNodeSource.local,
    nodeType,
  );

  const stack = [rootEntry];

  while (stack.length > 0) {
    const currentEntry = stack.pop();
    if (
      !currentEntry ||
      shouldIgnore(currentEntry.fullPath) ||
      !rootEntry.isDirectory()
    ) {
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
          await getRootFolderName(normalizedFilePath),
          entryType,
          stats.size,
          stats.mtime,
          normalizedFilePath,
          FileNodeSource.local,
        );

        newEntry.hash = await generateHash(
          normalizedFilePath,
          FileNodeSource.local,
          entryType,
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
