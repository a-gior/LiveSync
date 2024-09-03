import * as fs from "fs/promises";
import * as path from "path";
import { FileNode, FileNodeSource } from "../FileNode";
import pLimit = require("p-limit");
import { ConnectionManager } from "../../services/ConnectionManager";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import {
  LOG_FLAGS,
  logErrorMessage,
  LogManager,
} from "../../services/LogManager";
import { shouldIgnore } from "../shouldIgnore";
import { generateHash2, getLocalFileHash } from "./hashUtils";
import { StatusBarManager } from "../../services/StatusBarManager";
import { BaseNodeType } from "../BaseNode";
import { pathExists } from "./filePathUtils";
import { rejects } from "assert";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

export async function listRemoteFilesRecursive(
  remoteDir: string,
): Promise<FileNode | undefined> {
  console.log(`Listing remote ${remoteDir} recursively...`);

  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const connectionManager = ConnectionManager.getInstance(configuration);

  if (!(await pathExists(remoteDir, FileNodeSource.remote))) {
    logErrorMessage(
      `Could not find remotely the specified file/folder at ${remoteDir}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
    );
    return undefined;
  }

  try {
    return await connectionManager.doSSHOperation(async (sshClient) => {
      const command = `find "${remoteDir}" -exec sh -c 'if [ -d "$1" ]; then stat --format="%n,%s,%Y,%F," "$1"; else stat --format="%n,%s,%Y,%F" "$1" && sha256sum "$1" | awk "{printf \\"%s\\\\n\\", \\\$1}"; fi' sh {} \\;`;

      let rootEntry: FileNode | undefined;
      let currentEntry: FileNode | undefined;

      await sshClient.executeCommand(command, (data?: string) => {
        if (!data) return;
        const lines = data.trim().split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

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

          const newEntry = new FileNode(
            path.basename(fullPath),
            entryType,
            parseInt(size, 10),
            new Date(parseInt(modifyTime, 10) * 1000),
            fullPath,
            FileNodeSource.remote,
          );

          if (!rootEntry) {
            rootEntry = newEntry;
            currentEntry = rootEntry;
          } else {
            let hash = "";
            if (entryType === BaseNodeType.file && i + 1 < lines.length) {
              hash = lines[++i];
            }
            newEntry.hash = generateHash2(fullPath, entryType, hash);

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
          `Could not find remotely the specified file/folder at ${remoteDir}`,
        );
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
    nodeType,
    (await fs.stat(localDir)).size,
    (await fs.stat(localDir)).mtime,
    path.normalize(localDir),
    FileNodeSource.local,
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
