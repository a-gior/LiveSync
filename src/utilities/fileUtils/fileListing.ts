import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { FileNode, FileNodeSource } from "../FileNode";
import { ConnectionManager } from "../../managers/ConnectionManager";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "../../managers/LogManager";
import { shouldIgnore } from "../shouldIgnore";
import { generateHash } from "./hashUtils";
import { StatusBarManager } from "../../managers/StatusBarManager";
import { BaseNodeType } from "../BaseNode";
import { getFullPaths, normalizePath, pathType, splitParts } from "./filePathUtils";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";
import fg, { Entry } from "fast-glob";
import pMap from "p-map";
import { createHash } from "crypto";
import { Stats } from "fs";

//
// ─── LOCAL FILE LISTING ─────────────────────────────────────────────────────────
//

/**
 * Walks the tree under `localDir`, skipping ignored paths,
 * builds a FileNode tree (rooted at `localDir`), and invokes
 * `onNode` for each node (both files and folders).
 * Returns the `root` FileNode.
 */
async function traverseLocalTree(
  localDir: string,
  onNode: (node: FileNode) => void
): Promise<FileNode | undefined> {
  let rootStats: Stats;
  try {
    rootStats = await fs.stat(localDir);
    if (!rootStats.isDirectory()) {return undefined;}
  } catch {
    return undefined;
  }

  const rootPath = normalizePath(localDir);
  const root = new FileNode(
    path.basename(rootPath),
    BaseNodeType.directory,
    rootStats.size,
    rootStats.mtime,
    rootPath,
    FileNodeSource.local
  );

  const queue: FileNode[] = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    if (shouldIgnore(cur.fullPath)) {continue;}

    let entries: Entry[];
    try {
      entries = await fg("*", {
        cwd: cur.fullPath,
        dot: true,
        stats: true,
        onlyFiles: false
      });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (!e.stats) {continue;}
      const fullPath = normalizePath(path.join(cur.fullPath, e.path));
      if (shouldIgnore(fullPath)) {continue;}

      const isDir = e.stats.isDirectory();
      const child = new FileNode(
        e.path,
        isDir ? BaseNodeType.directory : BaseNodeType.file,
        e.stats.size,
        new Date(e.stats.mtimeMs),
        fullPath,
        FileNodeSource.local
      );
      cur.addChild(child);
      onNode(child);
      if (isDir) {queue.push(child);}
    }
  }

  return root;
}

export async function countLocalFiles(localDir: string): Promise<number> {
  let count = 0;
  await traverseLocalTree(localDir, () => {
    count++;
  });
  return count;
}

export async function listLocalFiles(localDir: string): Promise<FileNode|undefined> {
  StatusBarManager.showMessage(`Listing files on ${localDir}`, "", "", 0, "sync~spin", true);

  const fileNodes: FileNode[] = [];

  const root = await traverseLocalTree(localDir, node => {
    if (node.type === BaseNodeType.directory) {
      // count this directory as “processed”
      StatusBarManager.step();
    } else {
      fileNodes.push(node);
    }
  });
  if (!root) {return undefined;}

  // now hash files in parallel, updating progress per file
  await pMap(fileNodes, async node => {
    node.hash = await generateHash(node.fullPath, node.source, node.type);
    StatusBarManager.step();
  }, { concurrency: 16 });

  await computeFolderHashes(root);
  StatusBarManager.showMessage(`Listing files on ${localDir}`, "", "", 5000, "check");
  return root;
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

  if (!(await pathType(remoteDir, FileNodeSource.remote))) {
    logErrorMessage(
      `<listRemoteFiles> Could not find remotely the specified file/folder at ${remoteDir}`,
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );
    return undefined;
  }

  return connectionManager.doSSHOperation(
    async (sshClient) => {

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
        StatusBarManager.step();
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
          StatusBarManager.step();
          continue;
        }

        // fullPath is already relative (sed removed remoteDir/), so:
        const segments = splitParts(fullPath);
        const rel = segments.join("/");
        const size = parseInt(parts[1], 10);
        const mtime = parseInt(parts[2], 10) * 1000;
        fileStatMap.set(rel, { size, mtime });
        StatusBarManager.step();
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
        StatusBarManager.step();
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

      return rootEntry;
    },
    `Listing files on ${remoteDir}`
  );
}


export async function listRemoteFile(remoteFilePath: string): Promise<FileNode | undefined> {
  const configuration = WorkspaceConfigManager.getRemoteServerConfigured();
  const connectionManager = await ConnectionManager.getInstance(configuration);

  // Try to fetch as a single file
  const fileNode = await connectionManager.doSSHOperation(
    async (sshClient) => {
      // 1) is it a regular file?
      const fileCheckCmd = `[ -f "${remoteFilePath}" ] && echo "true" || echo "false"`;
      const isFileOutput = await sshClient.executeCommand(fileCheckCmd);
      if (isFileOutput.trim() !== "true") {
        return undefined;
      }

      // 2) grab size + mtime
      const statCmd = `stat --format="%s,%Y" "${remoteFilePath}"`;
      const statOutput = await sshClient.executeCommand(statCmd);
      const [sizeStr, mtimeStr] = statOutput.trim().split(",");
      const size = parseInt(sizeStr, 10);
      const mtime = new Date(parseInt(mtimeStr, 10) * 1000);
      const name = path.basename(remoteFilePath);

      // 3) build the FileNode
      const node = new FileNode(
        name,
        BaseNodeType.file,
        size,
        mtime,
        remoteFilePath,
        FileNodeSource.remote
      );

      // 4) compute hash
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

  if (fileNode) {
    return fileNode;
  }

  // Fallback: path wasn’t a file (or didn’t exist) → list its parent directory
  const parentDir = path.dirname(remoteFilePath);
  logInfoMessage(
    `<listRemoteFile> Path isn’t a file or doesn’t exist, falling back to listRemoteFiles for ${parentDir}`
  );
  return listRemoteFiles(parentDir);
}

export async function computeFolderHashes(node: FileNode): Promise<void> {
  if (!node.isDirectory()) {return;}
  // first recurse
  await Promise.all(Array.from(node.children.values()).map(n => computeFolderHashes(n)));
  // then combine child hashes
  const combined = Array.from(node.children.values())
    .map(c => c.hash ?? "")
    .sort()
    .join("");
  node.hash = createHash("sha256").update(combined).digest("hex");
}

/**
 * 1) Run `find … | wc -l` on the remote host and return the raw output.
 */
export async function fetchRemoteCountOutput(
  sshClient: any,
  remoteDir: string
): Promise<string> {
  const cmd = `find "${remoteDir}" | wc -l`;
  return sshClient.executeCommand(cmd);
}

/**
 * 2) Parse the raw `find | wc -l` output and return the item count.
 */
export function parseRemoteItemCount(rawOutput: string): number {
  const lines = rawOutput.trim().split('\n');
  const last = lines[lines.length - 1] || '0';
  const n = parseInt(last.trim(), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 3) From the same raw output, extract any “Permission denied” paths,
 *    add them to the ignore list, log a summary, and return them.
 */
export async function syncRemoteDeniedPaths(
  rawOutput: string
): Promise<string[]> {
  const lines = rawOutput.trim().split('\n');
  const deniedLines = lines.filter(l => l.includes('Permission denied'));

  const paths = deniedLines
    .map(l => {
      const m1 = l.match(/find: ‘(.+)’: Permission denied/);
      const m2 = l.match(/sha256sum: (.+): Permission denied/);
      return m1?.[1] ?? m2?.[1] ?? null;
    })
    .filter((p): p is string => !!p);

  if (paths.length) {
    await WorkspaceConfigManager.addToIgnoreList(...paths);
    logErrorMessage(
      `Skipped ${paths.length} inaccessible remote paths:\n` +
        paths.map(p => `  • ${p}`).join('\n'),
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );
  }

  return paths;
}