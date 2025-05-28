import * as fs from "fs/promises";
import * as path from "path";
import { FileNode, FileNodeSource } from "../FileNode";
import pLimit = require("p-limit");
import { ConnectionManager } from "../../managers/ConnectionManager";
import { LOG_FLAGS, logErrorMessage } from "../../managers/LogManager";
import { shouldIgnore } from "../shouldIgnore";
import { generateHash } from "./hashUtils";
import { StatusBarManager } from "../../managers/StatusBarManager";
import { BaseNodeType } from "../BaseNode";
import { normalizePath, pathExists, splitParts } from "./filePathUtils";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";

// Set a limit for the number of concurrent file operations, from 10 onwards triggers a warning for too much event listeners
const limit = pLimit(9);

export async function listRemoteFilesRecursive(remoteDir: string): Promise<FileNode | undefined> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  let totalItems = 0;
  let processedItems = 0;

  if (!(await pathExists(remoteDir, FileNodeSource.remote))) {
    logErrorMessage(
      `<listRemoteFilesRecursive> Could not find remotely the specified file/folder at ${remoteDir}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );
    return undefined;
  }

  return await connectionManager.doSSHOperation(async (sshClient) => {
    // ----- COUNT STAGE -----
    const countCommand   = `find "${remoteDir}" | wc -l`;
    const countOutputRaw = await sshClient.executeCommand(countCommand);

    const countLines      = countOutputRaw.trim().split("\n");
    const countDeniedLines = countLines.filter(l => l.includes("Permission denied"));
    const lastCountLine   = countLines[countLines.length - 1];
    totalItems            = parseInt(lastCountLine.trim(), 10) || 0;

    // Batch-ignore any paths denied in the count stage
    const countDeniedPaths = countDeniedLines
      .map(l => {
        const m1 = l.match(/find: ‘(.+)’: Permission denied/);
        const m2 = l.match(/sha256sum: (.+): Permission denied/);
        return m1?.[1] ?? m2?.[1] ?? null;
      })
      .filter((p): p is string => !!p);

    if (countDeniedPaths.length) {
      await WorkspaceConfigManager.addToIgnoreList(...countDeniedPaths);
      logErrorMessage(
        `Skipped ${countDeniedPaths.length} inaccessible paths at count-stage:\n` +
          countDeniedPaths.map(p => `  • ${p}`).join("\n"),
        LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
      );
    }

    if (totalItems === 0) {
      logErrorMessage(
        `<listRemoteFilesRecursive> No files found in ${remoteDir}`,
        LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
      );
      return undefined;
    }

    // ----- DETAIL STAGE -----
    const command = `
    # 1) directories first
    find "${remoteDir}" -type d \
      -exec sh -c 'stat --format="%n,%s,%Y,%F," "$1"' sh {} \\; \
    ;
    # 2) then files
    find "${remoteDir}" -type f \
      -exec sh -c 'stat --format="%n,%s,%Y,%F" "$1" && \
                    sha256sum "$1" | awk "{printf \\"%s\\\\n\\", \\$1}"' sh {} \\;
  `;
    console.log(`Command: ${command}`);

    let rootEntry: FileNode | undefined;
    const runtimeDeniedPaths: string[] = [];

    // We'll buffer directory/file metadata nodes until we know they hash successfully
    interface BufferedMeta { node: FileNode; parent: FileNode }
    let bufferedMeta: BufferedMeta | null = null;

    await sshClient.executeCommand(command, async (rawLine: string) => {
      const line = rawLine.trim();

      // 1) Directory-access denied?
      const findDenied = line.match(/^find: ‘(.+)’: Permission denied$/);
      if (findDenied) {
        // just skip directories we can't descend
        return;
      }

      // 2) File-hash denied?
      const shaDenied = line.match(/^sha256sum: (.+): Permission denied$/);
      if (shaDenied && bufferedMeta) {
        runtimeDeniedPaths.push(shaDenied[1]);
        bufferedMeta = null;               // drop the unhashed node
        processedItems++;
        StatusBarManager.showProgress(
          Math.min(100, Math.round((processedItems / totalItems) * 100))
        );
        return;
      }

      // 3) Real hash line? 64 hex chars
      if (/^[a-f0-9]{64}$/.test(line) && bufferedMeta) {
        // assign the hash, then *attach* the FileNode into the tree
        bufferedMeta.node.hash = await generateHash(bufferedMeta.node.fullPath, FileNodeSource.remote, BaseNodeType.file, line);
        bufferedMeta.parent.addChild(bufferedMeta.node);
        bufferedMeta = null;
        processedItems++;
        StatusBarManager.showProgress(
          Math.min(100, Math.round((processedItems / totalItems) * 100))
        );
        return;
      }

      // 4) Metadata line: fullPath,size,modifyTime,type
      const parts = line.split(",");
      if (parts.length < 4) {
        // unexpected line—ignore it
        return;
      }
      const [fullPath, sizeStr, mtimeStr, typeStr] = parts;
      if (shouldIgnore(fullPath)) {
        processedItems++;
        StatusBarManager.showProgress(
          Math.min(100, Math.round((processedItems / totalItems) * 100))
        );
        return;
      }

      const size      = parseInt(sizeStr, 10);
      const mtime     = new Date(parseInt(mtimeStr, 10) * 1000);
      const entryType = typeStr === "directory"
        ? BaseNodeType.directory
        : BaseNodeType.file;

      const node = new FileNode(
        path.basename(fullPath),
        entryType,
        size,
        mtime,
        fullPath,
        FileNodeSource.remote
      );

      // Find (or set) its parent in the tree
      if (!rootEntry) {
        // first directory or file becomes root
        rootEntry = node;
        processedItems++;
        StatusBarManager.showProgress(
          Math.min(100, Math.round((processedItems / totalItems) * 100))
        );
        return;
      }

      // Determine parent entry by walking from rootEntry
      const relPath = normalizePath(path.relative(rootEntry.fullPath, fullPath));
      const pathParts = splitParts(relPath);
      let parent = rootEntry;
      for (const part of pathParts.slice(0, -1)) {
        parent = parent.children.get(part)!;
      }

      if (entryType === BaseNodeType.directory) {
        // attach immediately
        parent.addChild(node);
        processedItems++;
        StatusBarManager.showProgress(
          Math.min(100, Math.round((processedItems / totalItems) * 100))
        );
      } else {
        // buffer this file until its hash comes through
        bufferedMeta = { node, parent: parent };
      }
    });

    // Add any runtime-denied files to the ignore list and log
    if (runtimeDeniedPaths.length) {
      await WorkspaceConfigManager.addToIgnoreList(...runtimeDeniedPaths);
      logErrorMessage(
        `Skipped ${runtimeDeniedPaths.length} inaccessible paths during scan:\n` +
          runtimeDeniedPaths.map(p => `  • ${p}`).join("\n"),
        LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
      );
    }

    if (!rootEntry) {
      throw new Error(
        `<listRemoteFilesRecursive> Could not build the FileNode for ${remoteDir}`
      );
    }
    return rootEntry;
  }, `Listing files on ${remoteDir}`);
}


export async function listLocalFilesRecursive(localDir: string): Promise<FileNode | undefined> {
  StatusBarManager.showMessage(`Listing files of ${localDir}`, "", "", 0, "sync~spin", true);

  const nodeType = await pathExists(localDir, FileNodeSource.local);
  if (!nodeType) {
    logErrorMessage(`Could not find locally the specified file/folder at ${localDir}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
    return undefined;
  }

  const rootEntry = new FileNode(
    path.basename(localDir),
    nodeType,
    (await fs.stat(localDir)).size,
    (await fs.stat(localDir)).mtime,
    normalizePath(localDir),
    FileNodeSource.local
  );

  rootEntry.hash = await generateHash(normalizePath(localDir), FileNodeSource.local, nodeType);

  const stack = [rootEntry];

  while (stack.length > 0) {
    const currentEntry = stack.pop();
    if (!currentEntry || shouldIgnore(currentEntry.fullPath) || !rootEntry.isDirectory()) {
      continue;
    }

    const currentDir = currentEntry.fullPath;
    const files = await fs.readdir(currentDir, { withFileTypes: true });

    const promises = files.map((file) =>
      limit(async () => {
        const filePath = path.join(currentDir, file.name);
        const normalizedFilePath = normalizePath(filePath);

        if (shouldIgnore(normalizedFilePath)) {
          return;
        }

        const stats = await fs.stat(normalizedFilePath);
        const entryType = file.isDirectory() ? BaseNodeType.directory : BaseNodeType.file;

        const newEntry = new FileNode(file.name, entryType, stats.size, stats.mtime, normalizedFilePath, FileNodeSource.local);

        newEntry.hash = await generateHash(normalizedFilePath, FileNodeSource.local, entryType);

        if (file.isDirectory()) {
          currentEntry.addChild(newEntry);
          stack.push(newEntry); // Add directory to stack for further processing
        } else {
          currentEntry.addChild(newEntry);
        }
      })
    );

    await Promise.all(promises); // Wait for all current directory operations to complete
  }

  StatusBarManager.showMessage(`Local file listed`, "", "", 3000, "check");
  return rootEntry;
}
