import * as path from "path";
import * as fs from "fs";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";
import { FileNodeSource } from "../FileNode";
import { compareRemoteFileHash, remotePathExists } from "./sftpOperations";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { LOG_FLAGS, logInfoMessage } from "../../services/LogManager";
import { BaseNodeType } from "../BaseNode";

export function normalizePath(p: string): string {
  let normalizedPath = path.normalize(p);
  if (process.platform === "win32") {
    normalizedPath =
      normalizedPath.charAt(0).toLowerCase() + normalizedPath.slice(1);
    normalizedPath = normalizedPath.replace(/\\/g, "/");
  }
  return normalizedPath;
}

/**
 * Returns the local & remote paths of a file based on its comparison status and relative path.
 * @param comparisonNode - The ComparisonFileNode object representing the file.
 * @returns An object containing both the local and remote paths of the file.
 * @throws Error if the paths cannot be found.
 */
export async function getFullPaths(
  comparisonNode: ComparisonFileNode,
): Promise<{ localPath: string | null; remotePath: string | null }> {
  const relativePath = normalizePath(comparisonNode.relativePath);
  const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();

  const createFullPath = (basePath: string) =>
    normalizePath(path.join(basePath, relativePath));

  // Iterate over the paired folders and check paths based on the comparison status
  for (const folder of pairedFolders) {
    let { localPath, remotePath } = {
      localPath: createFullPath(folder.localPath),
      remotePath: createFullPath(folder.remotePath),
    };

    const [localExists, remoteExists] = await Promise.all([
      pathExists(localPath, FileNodeSource.local),
      pathExists(remotePath, FileNodeSource.remote),
    ]);

    if (localExists && !remoteExists) {
      if (comparisonNode.status !== ComparisonStatus.added) {
        logInfoMessage(
          `<getFullPaths> Updating status of node from ${comparisonNode.status} to ${ComparisonStatus.added}`,
          LOG_FLAGS.CONSOLE_ONLY,
          comparisonNode,
        );
        comparisonNode.setStatus(ComparisonStatus.added);
      }
      remotePath = getCorrespondingPath(localPath);
    } else if (!localExists && remoteExists) {
      if (comparisonNode.status !== ComparisonStatus.removed) {
        logInfoMessage(
          `<getFullPaths> Updating status of node from ${comparisonNode.status} to ${ComparisonStatus.removed}`,
          LOG_FLAGS.CONSOLE_ONLY,
          comparisonNode,
        );
        comparisonNode.setStatus(ComparisonStatus.removed);
      }
      localPath = getCorrespondingPath(remotePath);
    } else {
      // localExists && remoteExists are true
      const isSame = await compareRemoteFileHash(comparisonNode);
      const newStatus = isSame
        ? ComparisonStatus.unchanged
        : ComparisonStatus.modified;
      if (newStatus !== comparisonNode.status) {
        logInfoMessage(
          `<getFullPaths> Updating status of node from ${comparisonNode.status} to ${newStatus}`,
          LOG_FLAGS.CONSOLE_ONLY,
          comparisonNode,
        );
        comparisonNode.setStatus(newStatus);
      }
    }

    return { localPath, remotePath };
  }

  // Log and return null paths if not found
  logInfoMessage(
    `<getFullPaths> \n\trelativePath: ${relativePath}, \n\tlocalPath: null, \n\tremotePath: null`,
  );
  return { localPath: null, remotePath: null };
}

export function getCorrespondingPath(inputPath: string): string {
  const normalizedInputPath = normalizePath(inputPath);
  const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();

  for (const folder of pairedFolders) {
    // Check if the inputPath is a local path
    if (normalizedInputPath.startsWith(normalizePath(folder.localPath))) {
      return path
        .join(folder.remotePath, path.relative(folder.localPath, inputPath))
        .replace(/\\/g, "/");
    }

    // Check if the inputPath is a remote path
    if (normalizedInputPath.startsWith(normalizePath(folder.remotePath))) {
      return path
        .join(folder.localPath, path.relative(folder.remotePath, inputPath))
        .replace(/\\/g, "/");
    }
  }

  throw new Error(`Couldnt find corresponding path of ${inputPath}`);
}

export function isRootPath(
  targetPath: string,
  pairedFolders: PairFoldersMessage["paths"][],
): boolean {
  const normalizedTargetPath = normalizePath(targetPath);
  return pairedFolders.some(
    (folder) =>
      normalizedTargetPath === normalizePath(folder.localPath) ||
      normalizedTargetPath === normalizePath(folder.remotePath),
  );
}

export async function getRootFolderName(targetPath: string): Promise<string> {
  const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();
  const normalizedTargetPath = normalizePath(targetPath);

  for (const folder of pairedFolders) {
    const normalizedLocalPath = normalizePath(folder.localPath);
    const normalizedRemotePath = normalizePath(folder.remotePath);

    // Check if targetPath is within either localPath or remotePath
    if (normalizedTargetPath.startsWith(normalizedLocalPath)) {
      return Promise.resolve(path.basename(normalizedLocalPath));
    }
    if (normalizedTargetPath.startsWith(normalizedRemotePath)) {
      return Promise.resolve(path.basename(normalizedRemotePath));
    }
  }

  throw new Error(`Couldn't find a Root Folder name for ${targetPath}`);
}

export async function pathExists(path: string, source: FileNodeSource) {
  switch (source) {
    case FileNodeSource.local:
      return localPathExists(path);
    case FileNodeSource.remote:
      return await remotePathExists(path);
    default:
      throw new Error("[FileNode - exists()] Wrong FileNode source.");
  }
}

function localPathExists(path: string): BaseNodeType | false {
  if (fs.existsSync(path)) {
    const stats = fs.lstatSync(path);
    if (stats.isDirectory()) {
      return BaseNodeType.directory;
    } else if (stats.isFile()) {
      return BaseNodeType.file;
    }
  }
  return false;
}

export function comparePaths(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}
