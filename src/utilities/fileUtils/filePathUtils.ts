import * as path from "path";
import * as fs from "fs";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";
import { FileEntrySource } from "../FileEntry";
import { remotePathExists } from "./sftpOperations";

export function normalizePath(p: string): string {
  let normalizedPath = path.normalize(p);
  if (process.platform === "win32") {
    normalizedPath =
      normalizedPath.charAt(0).toLowerCase() + normalizedPath.slice(1);
    normalizedPath = normalizedPath.replace(/\\/g, "/");
  }
  return normalizedPath;
}

export function getRemotePath(
  localPath: string,
  pairedFolders: PairFoldersMessage["paths"][],
): string | null {
  for (const folder of pairedFolders) {
    if (normalizePath(localPath).startsWith(normalizePath(folder.localPath))) {
      return path
        .join(folder.remotePath, path.relative(folder.localPath, localPath))
        .replace(/\\/g, "/");
    }
  }
  return null;
}

export function getLocalPath(
  remotePath: string,
  pairedFolders: PairFoldersMessage["paths"][],
): string | null {
  for (const folder of pairedFolders) {
    if (
      normalizePath(remotePath).startsWith(normalizePath(folder.remotePath))
    ) {
      return path
        .join(folder.localPath, path.relative(folder.remotePath, remotePath))
        .replace(/\\/g, "/");
    }
  }
  return null;
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

export function getRelativePath(
  pairedFolders: PairFoldersMessage["paths"][],
  fullPath: string,
  fileSource: FileEntrySource,
): string {
  const normalizedTargetPath = normalizePath(fullPath);
  for (const folder of pairedFolders) {
    if (
      fileSource === FileEntrySource.local &&
      normalizedTargetPath.startsWith(normalizePath(folder.localPath))
    ) {
      return path.relative(folder.localPath, fullPath);
    }

    if (
      fileSource === FileEntrySource.remote &&
      normalizedTargetPath.startsWith(normalizePath(folder.remotePath))
    ) {
      return path.relative(folder.remotePath, fullPath);
    }
  }
  return "";
}

export async function pathExists(path: string, source: FileEntrySource) {
  switch (source) {
    case FileEntrySource.local:
      return fs.existsSync(path);
    case FileEntrySource.remote:
      return await remotePathExists(path);
    default:
      throw Error("[FileEntry - exists()] Wrong FileEntry source.");
  }
}

export function comparePaths(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}
