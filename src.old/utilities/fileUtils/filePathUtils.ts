import * as path from "path";
import * as fs from "fs";
import { FileNodeSource } from "../FileNode";
import { remotePathType } from "./sftpOperations";
import { ComparisonFileNode } from "../ComparisonFileNode";
import { BaseNodeType } from "../BaseNode";
import { configManager } from "../../extension";
import { RELATIVE_PATH_SEP } from "../constants";

export type PathPair = {localPath: string, remotePath: string};

/**
 * Collapse dots, resolve segments, unify on forward-slashes,
 * lowercase Windows drives, strip redundant slashes.
 *
 * Works for:
 * - Windows absolutes: "C:\\Foo\\Bar"  → "c:/Foo/Bar"
 * - Linux absolutes:   "/foo//bar/../baz" → "/foo/baz"
 * - Relative paths:    "./foo\\bar"      → "foo/bar"
 */
export function normalizePath(p: string): string {
  // 1. Let node collapse ., .. and mixed separators
  let normalized = path.normalize(p);

  // 2. Replace ALL backslashes with forward-slash
  normalized = normalized.replace(/\\/g, "/");

  // 3. Lowercase drive letter on Windows absolutes (e.g. "C:/")
  normalized = normalized.replace(
    /^([A-Za-z]):\//,
    (_match, drive) => drive.toLowerCase() + ":/"
  );

  // 4. Collapse multiple forward-slashes → single
  normalized = normalized.replace(/\/+/g, "/");

  // 5. Strip trailing slash, unless it’s the only character (root)
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
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
  const { localPath, remotePath } = configManager!.getConfig(comparisonNode.workspaceFolder.uri).getPathPair();

  let { normalizedLocalPath, normalizedRemotePath } = {
    normalizedLocalPath: normalizePath(path.join(localPath, relativePath)),
    normalizedRemotePath: normalizePath(path.join(remotePath, relativePath))
  };

  return { localPath: normalizedLocalPath, remotePath: normalizedRemotePath };
}

export function getRelativePath(fullPath: string, source: FileNodeSource) {
  const folder = configManager!.getWorkspaceFolderFromPath(fullPath, source);
  const workspaceConfig = configManager!.getConfig(folder.uri);
  const normalizedFullPath = normalizePath(fullPath);

  const { localPath, remotePath } = workspaceConfig.getPathPair();
  if (normalizedFullPath.startsWith(localPath)) {
    return normalizePath(path.relative(localPath, fullPath));
  } else if (normalizedFullPath.startsWith(remotePath)) {
    return normalizePath(path.relative(remotePath, fullPath));
  }
  throw new Error(`Couldnt find relative path of ${fullPath}`);
}

export async function pathType(path: string, source: FileNodeSource) {
  switch (source) {
    case FileNodeSource.local:
      return localPathType(path);
    case FileNodeSource.remote:
      return await remotePathType(path);
    default:
      throw new Error("[FileNode - pathExists()] Wrong FileNode source.");
  }
}

export async function pathExists(path: string, source: FileNodeSource): Promise<boolean> {
  return await pathType(path, source) !== false;
}

function localPathType(path: string): BaseNodeType | false {
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
