import * as path from "path";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";

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
