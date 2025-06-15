import * as fs from "fs/promises";
import { Dirent, Stats } from "fs";
import * as path from "path";
import { FileNode, FileNodeSource } from "../FileNode";
import pLimit from "p-limit";
import { ConnectionManager } from "../../managers/ConnectionManager";
import { LOG_FLAGS, logErrorMessage } from "../../managers/LogManager";
import { shouldIgnore } from "../shouldIgnore";
import { generateHash } from "./hashUtils";
import { StatusBarManager } from "../../managers/StatusBarManager";
import { BaseNodeType } from "../BaseNode";
import { normalizePath, pathExists, splitParts } from "./filePathUtils";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";

// Limit concurrent file operations to 9
const limit = pLimit(9);

//
// ─── LOCAL FILE LISTING ─────────────────────────────────────────────────────────
//

/**
 * Counts all files and directories under `dir`, excluding ignored ones, for progress tracking.
 */
async function countLocalItems(dir: string): Promise<number> {
  let count = 0;
  const queue: string[] = [dir];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of entries) {
      const fullPath = normalizePath(path.join(current, dirent.name));
      if (shouldIgnore(fullPath)) {
        continue;
      }
      count++;
      if (dirent.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }

  return count;
}

/**
 * Builds the local file tree under `localDir`, showing real percentage progress.
 */
export async function listLocalFiles(
  localDir: string
): Promise<FileNode | undefined> {
  StatusBarManager.showMessage(
    `Listing files of ${localDir}`,
    "",
    "",
    0,
    "sync~spin",
    true
  );

  const nodeType = await pathExists(localDir, FileNodeSource.local);
  if (!nodeType) {
    logErrorMessage(
      `Could not find locally the specified file/folder at ${localDir}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );
    return undefined;
  }

  // Count total items for progress
  const totalItems = await countLocalItems(localDir);
  let processedItems = 0;
  const updateProgress = () => {
    const percent = totalItems > 0
      ? Math.round((processedItems / totalItems) * 100)
      : 100;
    StatusBarManager.showProgress(Math.min(100, percent));
  };

  // Stat root once
  let rootStats: Stats;
  try {
    rootStats = await fs.stat(localDir);
  } catch (err: any) {
    logErrorMessage(
      `Error stating root directory ${localDir}: ${err.message}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );
    return undefined;
  }

  const rootEntry = new FileNode(
    path.basename(localDir),
    nodeType,
    rootStats.size,
    rootStats.mtime,
    normalizePath(localDir),
    FileNodeSource.local
  );

  // Use a FIFO queue for breadth-first traversal
  const dirQueue: FileNode[] = [];
  if (rootEntry.isDirectory()) {
    dirQueue.push(rootEntry);
    processedItems++; // count the root itself
    updateProgress();
  }

  // Traverse directories
  while (dirQueue.length > 0) {
    const currentDirNode = dirQueue.shift()!;
    const currentDirPath = currentDirNode.fullPath;

    let dirEntries: Dirent[];
    try {
      dirEntries = await fs.readdir(currentDirPath, { withFileTypes: true });
    } catch (err: any) {
      logErrorMessage(
        `Error reading directory ${currentDirPath}: ${err.message}`,
        LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
      );
      continue;
    }

    const tasks: Promise<void>[] = [];

    for (const dirent of dirEntries) {
      tasks.push(
        limit(async () => {
          const entryName = dirent.name;
          const fullPath = path.join(currentDirPath, entryName);
          const normalizedFull = normalizePath(fullPath);

          if (shouldIgnore(normalizedFull)) {
            processedItems++;
            updateProgress();
            return;
          }

          let st: Stats;
          try {
            st = await fs.stat(normalizedFull);
          } catch (err: any) {
            logErrorMessage(
              `Error stating ${normalizedFull}: ${err.message}`,
              LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
            );
            processedItems++;
            updateProgress();
            return;
          }

          const entryType: BaseNodeType = st.isDirectory()
            ? BaseNodeType.directory
            : BaseNodeType.file;

          const childNode = new FileNode(
            entryName,
            entryType,
            st.size,
            st.mtime,
            normalizedFull,
            FileNodeSource.local
          );

          currentDirNode.addChild(childNode);
          processedItems++;
          updateProgress();

          if (entryType === BaseNodeType.directory) {
            dirQueue.push(childNode);
            return;
          }

          // For files: compute hash
          try {
            childNode.hash = await generateHash(
              normalizedFull,
              FileNodeSource.local,
              entryType
            );
          } catch (err: any) {
            logErrorMessage(
              `Error hashing ${normalizedFull}: ${err.message}`,
              LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
            );
          }
        })
      );
    }

    await Promise.all(tasks);
  }

  // Compute hashes for all folders
  await computeFolderHashes(rootEntry);

  StatusBarManager.showMessage(`Local files listed`, "", "", 3000, "check");
  return rootEntry;
}

//
// ─── REMOTE FILE LISTING ────────────────────────────────────────────────────────
//

/**
 * Listing remote files by batching find/stat/sha256 commands over SSH,
 * showing real percentage progress.
 */
export async function listRemoteFiles(
  remoteDir: string
): Promise<FileNode | undefined> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  if (!(await pathExists(remoteDir, FileNodeSource.remote))) {
    logErrorMessage(
      `<listRemoteFiles> Could not find remotely the specified file/folder at ${remoteDir}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );
    return undefined;
  }

  return connectionManager.doSSHOperation(
    async (sshClient) => {
      // Count total items for progress indication
      const countCommand = `find "${remoteDir}" | wc -l`;
      const countOutputRaw = await sshClient.executeCommand(countCommand);

      const countLines = countOutputRaw.trim().split("\n");
      const countDeniedLines = countLines.filter((l) =>
        l.includes("Permission denied")
      );
      const lastCountLine = countLines[countLines.length - 1];
      const totalItems = parseInt(lastCountLine.trim(), 10) || 0;
      let processedItems = 0;
      const updateProgress = () => {
        const percent = totalItems > 0
          ? Math.round((processedItems / totalItems) * 100)
          : 100;
        StatusBarManager.showProgress(Math.min(100, percent));
      };

      // Handle any denied paths from count stage
      const countDeniedPaths = countDeniedLines
        .map((l) => {
          const m1 = l.match(/find: ‘(.+)’: Permission denied/);
          const m2 = l.match(/sha256sum: (.+): Permission denied/);
          return m1?.[1] ?? m2?.[1] ?? null;
        })
        .filter((p): p is string => !!p);

      if (countDeniedPaths.length) {
        await WorkspaceConfigManager.addToIgnoreList(...countDeniedPaths);
        logErrorMessage(
          `Skipped ${countDeniedPaths.length} inaccessible paths at count-stage:\n` +
            countDeniedPaths.map((p) => `  • ${p}`).join("\n"),
          LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
        );
      }

      if (totalItems === 0) {
        logErrorMessage(
          `<listRemoteFiles> No files found in ${remoteDir}`,
          LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
        );
        return undefined;
      }

      // 1) Fetch all directory metadata (path,size,mtime,type) in one stat batch
      const dirStatCmd = `find "${remoteDir}" -type d -exec stat --format="%n,%s,%Y,%F" {} +`;
      const dirsRaw = await sshClient.executeCommand(dirStatCmd);

      // 2) Fetch all file stat info in one batch, strip leading remoteDir prefix, sort
      const fileStatCmd = `
        find "${remoteDir}" -type f -exec stat --format="%n,%s,%Y,%F" {} + \
        | sed "s|^${remoteDir}/||" | sort
      `;
      const filesStatRaw = await sshClient.executeCommand(fileStatCmd);

      // 3) Fetch all file hashes in one batch, strip prefix, sort
      const fileHashCmd = `
        find "${remoteDir}" -type f -exec sha256sum {} + \
        | sed -E "s|\\s+${remoteDir}/|,|" | sort
      `;
      const filesHashRaw = await sshClient.executeCommand(fileHashCmd);

      // Parse directory entries into a flat map
      const dirEntries = dirsRaw.trim().split("\n");
      const dirMap = new Map<string, { size: number; mtime: number }>();
      for (const line of dirEntries) {
        const parts = line.trim().split(",");
        if (parts.length < 4) {
          continue;
        }
        const fullPath = parts[0];
        if (shouldIgnore(fullPath)) {
          continue;
        }

        // Determine `rel` using splitParts
        let rel: string;
        if (fullPath === remoteDir) {
          rel = ".";
        } else if (fullPath.startsWith(remoteDir + "/")) {
          const remainder = fullPath.slice(remoteDir.length + 1);
          const segments = splitParts(remainder);
          rel = segments.join("/");
        } else {
          const segments = splitParts(fullPath);
          rel = segments.join("/");
        }

        const size = parseInt(parts[1], 10);
        const mtime = parseInt(parts[2], 10) * 1000;
        dirMap.set(rel, { size, mtime });
        processedItems++;
        updateProgress();
      }

      // Parse file stats into a map: relPath → { size, mtime }
      const fileStatLines = filesStatRaw.trim().split("\n");
      const fileStatMap = new Map<string, { size: number; mtime: number }>();
      for (const raw of fileStatLines) {
        const parts = raw.trim().split(",");
        if (parts.length < 4) {
          continue;
        }
        const fullPath = parts[0];
        if (shouldIgnore(fullPath)) {
          processedItems++;
          updateProgress();
          continue;
        }

        // fullPath is already relative (sed removed remoteDir/), so:
        const segments = splitParts(fullPath);
        const rel = segments.join("/");
        const size = parseInt(parts[1], 10);
        const mtime = parseInt(parts[2], 10) * 1000;
        fileStatMap.set(rel, { size, mtime });
        processedItems++;
        updateProgress();
      }

      // Parse file hashes into a map: relPath → hash
      const fileHashLines = filesHashRaw.trim().split("\n");
      const fileHashMap = new Map<string, string>();
      for (const raw of fileHashLines) {
        const parts = raw.trim().split(",");
        if (parts.length < 2) {
          continue;
        }
        const rel = parts[1];
        const hash = parts[0];
        fileHashMap.set(rel, hash);
        processedItems++;
        updateProgress();
      }

      // Build directory FileNode objects first
      let rootEntry: FileNode | undefined;
      const dirNodeMap = new Map<string, FileNode>();

      for (const [rel, meta] of dirMap.entries()) {
        const name = rel === "." ? path.basename(remoteDir) : path.basename(rel);
        const fullPath = rel === "." ? remoteDir : `${remoteDir}/${rel}`;
        const node = new FileNode(
          name,
          BaseNodeType.directory,
          meta.size,
          new Date(meta.mtime),
          fullPath,
          FileNodeSource.remote
        );
        dirNodeMap.set(rel, node);
        if (rel === ".") {
          rootEntry = node;
        }
      }

      if (!rootEntry) {
        logErrorMessage(
          `<listRemoteFiles> Could not build root for ${remoteDir}`,
          LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
        );
        return undefined;
      }

      // Attach each directory under its parent, using splitParts
      for (const [rel, node] of dirNodeMap.entries()) {
        if (rel === ".") {
          continue;
        }
        const segments = splitParts(rel);
        const parentRel =
          segments.length === 1 ? "." : segments.slice(0, segments.length - 1).join("/");
        const parentNode = dirNodeMap.get(parentRel);
        if (parentNode) {
          parentNode.addChild(node);
        }
      }

      // Build file FileNode objects and attach under parent directories
      for (const [rel, meta] of fileStatMap.entries()) {
        const hash = fileHashMap.get(rel) || "";
        const name = path.basename(rel);
        const fullPath = `${remoteDir}/${rel}`;
        const node = new FileNode(
          name,
          BaseNodeType.file,
          meta.size,
          new Date(meta.mtime),
          fullPath,
          FileNodeSource.remote
        );
        try {
          node.hash = await generateHash(
            fullPath,
            FileNodeSource.remote,
            BaseNodeType.file,
            hash
          );
        } catch (err: any) {
          logErrorMessage(
            `Error hashing remote file ${fullPath}: ${err.message}`,
            LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
          );
        }

        const segments = splitParts(rel);
        const parentRel =
          segments.length === 1 ? "." : segments.slice(0, segments.length - 1).join("/");
        const parentNode = dirNodeMap.get(parentRel);
        if (parentNode) {
          parentNode.addChild(node);
        }
      }

      // Compute hashes for all folders
      await computeFolderHashes(rootEntry);

      StatusBarManager.showMessage(`Remote files listed`, "", "", 3000, "check");
      return rootEntry;
    },
    `Listing files on ${remoteDir}`
  );
}

export async function listRemoteFile(remoteFilePath: string): Promise<FileNode | undefined> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  return connectionManager.doSSHOperation(
    async (sshClient) => {
      // Check if it's a valid file
      const fileCheckCmd = `[ -f "${remoteFilePath}" ] && echo "true" || echo "false"`;
      const isFileOutput = await sshClient.executeCommand(fileCheckCmd);
      if (isFileOutput.trim() !== "true") {
        logErrorMessage(
          `<listRemoteFile> Path is not a file or doesn't exist: ${remoteFilePath}`,
          LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
        );
        return undefined;
      }

      // Get stat info: size, mtime
      const statCmd = `stat --format="%s,%Y" "${remoteFilePath}"`;
      const statOutput = await sshClient.executeCommand(statCmd);
      const [sizeStr, mtimeStr] = statOutput.trim().split(",");
      const size = parseInt(sizeStr, 10);
      const mtime = new Date(parseInt(mtimeStr, 10) * 1000);
      const name = path.basename(remoteFilePath);

      const node = new FileNode(
        name,
        BaseNodeType.file,
        size,
        mtime,
        remoteFilePath,
        FileNodeSource.remote
      );

      try {
        node.hash = await generateHash(
          remoteFilePath,
          FileNodeSource.remote,
          BaseNodeType.file
        );
      } catch (err: any) {
        logErrorMessage(
          `Error hashing remote file ${remoteFilePath}: ${err.message}`,
          LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
        );
      }

      return node;
    },
    `Fetching info from ${remoteFilePath}`
  );
}

/**
 * Recursively compute folder hashes for either local or remote trees.
 */
async function computeFolderHashes(node: FileNode): Promise<void> {
  if (!node.isDirectory()) {
    return;
  }
  for (const child of node.children.values()) {
    await computeFolderHashes(child);
  }
  try {
    node.hash = await generateHash(
      node.fullPath,
      node.source,
      BaseNodeType.directory
    );
  } catch (err: any) {
    logErrorMessage(
      `Error hashing directory ${node.fullPath}: ${err.message}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );
  }
}
