import * as path from "path";
import * as fs from "fs";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";
import { FileEntrySource } from "../FileEntry";
import { remotePathExists } from "./sftpOperations";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";

export function normalizePath(p: string): string {
  let normalizedPath = path.normalize(p);
  if (process.platform === "win32") {
    normalizedPath =
      normalizedPath.charAt(0).toLowerCase() + normalizedPath.slice(1);
    normalizedPath = normalizedPath.replace(/\\/g, "/");
  }
  return normalizedPath;
}

export function getCorrespondingPath(inputPath: string): string {
  const normalizedInputPath = normalizePath(inputPath);
  const pairedFolders =
    WorkspaceConfig.getInstance().getPairedFoldersConfigured();

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

  throw Error(`Couldnt find corresponding path of ${inputPath}`);
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
  fullPath: string,
  fileSource: FileEntrySource,
): string {
  const pairedFolders =
    WorkspaceConfig.getInstance().getPairedFoldersConfigured();
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
