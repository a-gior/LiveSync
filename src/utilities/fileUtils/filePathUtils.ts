import * as path from "path";
import * as fs from "fs";
import { FileNodeSource } from "../FileNode";
import { remotePathExists } from "./sftpOperations";
import { ComparisonFileNode } from "../ComparisonFileNode";
import { BaseNodeType } from "../BaseNode";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";
import { LINUX_PATH_SEP, RELATIVE_PATH_SEP, WINDOWS_PATH_SEP } from "../constants";

/**
 * Normalizes a given path and converts it to a specified format (Windows or Linux).
 * @param p - The input path.
 * @param targetFormat - The desired format ("windows" or "linux").
 * @returns The normalized path in the specified format.
 */
export function normalizePath(p: string): string {
  // Normalize the path first
  let normalizedPath = path.normalize(p);

  // Detect path type
  const isFullWindowsPath = /^[a-zA-Z]:[\\/]/.test(p); // Matches "C:\" or "C:/"
  const isFullLinuxPath = /^\//.test(p); // Matches "/"
  const isRelativePath = !isFullWindowsPath && !isFullLinuxPath;

  if (isFullWindowsPath) {
    // Ensure drive letter is lowercase
    normalizedPath = normalizedPath.charAt(0).toLowerCase() + normalizedPath.slice(1);
    normalizedPath = normalizedPath.replace(/\//g, WINDOWS_PATH_SEP);
  }

  if (isFullLinuxPath) {
    normalizedPath = normalizedPath.replace(/\\/g, LINUX_PATH_SEP);
  }

  if (isRelativePath) {
    normalizedPath = normalizedPath.replace(/\\/g, RELATIVE_PATH_SEP);
  }

  return normalizedPath;
}

export function splitParts(relativePath: string): string[] {
  return relativePath.split(RELATIVE_PATH_SEP).filter(Boolean);
}

export function joinParts(parts: string[]): string {
  return parts.join(RELATIVE_PATH_SEP);
}

/**
 * Returns the local & remote paths of a file based on its comparison status and relative path.
 * @param comparisonNode - The ComparisonFileNode object representing the file.
 * @returns An object containing both the local and remote paths of the file.
 * @throws Error if the paths cannot be found.
 */
export async function getFullPaths(comparisonNode: ComparisonFileNode): Promise<{ localPath: string; remotePath: string }> {
  const relativePath = normalizePath(comparisonNode.relativePath);
  const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();

  let { normalizedLocalPath, normalizedRemotePath } = {
    normalizedLocalPath: normalizePath(path.join(localPath, relativePath)),
    normalizedRemotePath: normalizePath(path.join(remotePath, relativePath))
  };

  return { localPath: normalizedLocalPath, remotePath: normalizedRemotePath };
}

export function getCorrespondingPath(inputPath: string): string {
  const normalizedInputPath = normalizePath(inputPath);
  const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();

  // Check if the inputPath is a local path
  if (normalizedInputPath.startsWith(normalizePath(localPath))) {
    return path.join(remotePath, path.relative(localPath, inputPath)).replace(/\\/g, "/");
  }

  // Check if the inputPath is a remote path
  if (normalizedInputPath.startsWith(normalizePath(remotePath))) {
    return path.join(localPath, path.relative(remotePath, inputPath)).replace(/\\/g, "/");
  }

  throw new Error(`Couldnt find corresponding path of ${inputPath}`);
}

export function getRelativePath(fullPath: string) {
  const normalizedFullPath = normalizePath(fullPath);
  const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();
  if (normalizedFullPath.startsWith(localPath)) {
    return normalizePath(path.relative(localPath, fullPath));
  } else if (normalizedFullPath.startsWith(remotePath)) {
    return normalizePath(path.relative(remotePath, fullPath));
  }
  throw new Error(`Couldnt find relative path of ${fullPath}`);
}

export function isRootPath(targetPath: string): boolean {
  const normalizedTargetPath = normalizePath(targetPath);
  const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();

  return normalizedTargetPath === normalizePath(localPath) || normalizedTargetPath === normalizePath(remotePath);
}

export async function pathExists(path: string, source: FileNodeSource) {
  switch (source) {
    case FileNodeSource.local:
      return localPathExists(path);
    case FileNodeSource.remote:
      return await remotePathExists(path);
    default:
      throw new Error("[FileNode - pathExists()] Wrong FileNode source.");
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
