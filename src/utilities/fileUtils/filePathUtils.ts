import * as path from "path";
import * as fs from "fs";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";
import { FileNodeSource } from "../FileNode";
import { remotePathExists } from "./sftpOperations";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import { ComparisonFileNode } from "../ComparisonFileNode";

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
 * Returns the full paths of a file based on its comparison status and relative path.
 * 
 * @param comparisonNode - The ComparisonFileNode object representing the file.
 * @returns An object containing both the local and remote paths of the file.
 * @throws Error if the paths cannot be found.
 */
export function getFullPaths(comparisonNode: ComparisonFileNode): { localPath: string | null, remotePath: string | null } {
  const relativePath = normalizePath(comparisonNode.relativePath);
  const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();

  const createFullPath = (basePath: string) => normalizePath(path.join(basePath, relativePath));

  let localPath: string | null = null;
  let remotePath: string | null = null;

  for (const folder of pairedFolders) {
    const possibleLocalPath = createFullPath(folder.localPath);
    const possibleRemotePath = createFullPath(folder.remotePath);

    if (!localPath && fs.existsSync(possibleLocalPath)) {
      localPath = possibleLocalPath;
    }

    if (!remotePath && fs.existsSync(possibleRemotePath)) {
      remotePath = possibleRemotePath;
    }

    // If both paths are found, no need to continue
    if (localPath && remotePath) {
      break;
    }
  }

  return { localPath, remotePath };
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

export function getRelativePath(fullPath: string): string {
  const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();
  const normalizedTargetPath = normalizePath(fullPath);

  for (const folder of pairedFolders) {
    if (normalizedTargetPath.startsWith(normalizePath(folder.localPath))) {
      return path.relative(folder.localPath, fullPath);
    }

    if (normalizedTargetPath.startsWith(normalizePath(folder.remotePath))) {
      return path.relative(folder.remotePath, fullPath);
    }
  }
  return "";
}

export async function pathExists(path: string, source: FileNodeSource) {
  switch (source) {
    case FileNodeSource.local:
      return fs.existsSync(path);
    case FileNodeSource.remote:
      return await remotePathExists(path);
    default:
      throw new Error("[FileNode - exists()] Wrong FileNode source.");
  }
}

export function comparePaths(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}
