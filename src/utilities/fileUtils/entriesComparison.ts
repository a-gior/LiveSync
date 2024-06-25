import {
  FileEntry,
  FileEntrySource,
  FileEntryStatus,
  FileEntryType,
} from "../FileEntry";
import { generateHash } from "./hashUtils";
import { workspace } from "vscode";
import { getCorrespondingPath } from "./filePathUtils";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "./fileListing";

async function compareEntries(
  localEntry: FileEntry | undefined,
  remoteEntry: FileEntry | undefined,
  parent: FileEntry,
): Promise<void> {
  if (!localEntry && remoteEntry) {
    remoteEntry.updateStatus(FileEntryStatus.removed);
    parent.addChild(remoteEntry);
    for (const child of remoteEntry.children.values()) {
      await compareEntries(undefined, child, remoteEntry);
    }
    updateDirectoryStatusBasedOnChildren(remoteEntry);
    return;
  }

  if (localEntry && !remoteEntry) {
    localEntry.updateStatus(FileEntryStatus.added);
    parent.addChild(localEntry);
    for (const child of localEntry.children.values()) {
      await compareEntries(child, undefined, localEntry);
    }
    updateDirectoryStatusBasedOnChildren(localEntry);
    return;
  }

  if (localEntry && remoteEntry) {
    const currentEntry = new FileEntry(
      localEntry.name,
      localEntry.type,
      localEntry.size,
      localEntry.modifiedTime,
      localEntry.source,
      localEntry.fullPath,
    );

    if (
      localEntry.type === FileEntryType.file &&
      remoteEntry.type === FileEntryType.file
    ) {
      const [localHash, remoteHash] = await Promise.all([
        generateHash(localEntry.fullPath, localEntry.source, localEntry.type),
        generateHash(
          remoteEntry.fullPath,
          remoteEntry.source,
          remoteEntry.type,
        ),
      ]);

      if (localHash !== remoteHash) {
        currentEntry.updateStatus(FileEntryStatus.modified);
        parent.updateStatus(FileEntryStatus.modified);
      } else {
        currentEntry.updateStatus(FileEntryStatus.unchanged);
      }
    } else {
      currentEntry.updateStatus(FileEntryStatus.unchanged);
    }

    const showUnchanged = workspace
      .getConfiguration("LiveSync")
      .get<boolean>("showUnchanged", true);

    if (
      !(
        showUnchanged === false &&
        currentEntry.status === FileEntryStatus.unchanged
      )
    ) {
      parent.addChild(currentEntry);
    }

    const allKeys = new Set([
      ...localEntry.children.keys(),
      ...remoteEntry.children.keys(),
    ]);

    for (const key of allKeys) {
      await compareEntries(
        localEntry.children.get(key),
        remoteEntry.children.get(key),
        currentEntry,
      );
    }

    updateDirectoryStatusBasedOnChildren(currentEntry);
    return;
  }
}

/**
 * Updates the status of a directory based on the statuses of its children.
 * @param currentEntry The current directory entry whose status needs to be updated.
 */
function updateDirectoryStatusBasedOnChildren(currentEntry: FileEntry) {
  let previousStatus: FileEntryStatus | undefined;

  // Iterate over the children and track their statuses
  for (const child of currentEntry.children.values()) {
    if (!child.status) {
      console.error(
        `[updateDirectoryStatusBasedOnChildren] CurrentEntry (${currentEntry.name}) child ${child.name} parameter has no status`,
      );
      return;
    }

    if (
      child.status === FileEntryStatus.modified ||
      (previousStatus && previousStatus !== child.status)
    ) {
      currentEntry.updateStatus(FileEntryStatus.modified);
      return; // Early exit on first modified status
    }
    previousStatus = child.status;
  }

  return previousStatus;
}

export async function compareLocalAndRemote(
  localRoot: FileEntry,
  remoteRoot: FileEntry,
): Promise<Map<string, FileEntry>> {
  const root = new FileEntry(
    localRoot.name,
    FileEntryType.directory,
    localRoot.size,
    localRoot.modifiedTime,
    localRoot.source,
    localRoot.fullPath,
  );
  await compareEntries(localRoot, remoteRoot, root);
  return root.children;
}

export async function compareCorrespondingEntry(
  fileEntry: FileEntry,
): Promise<FileEntry> {
  try {
    const localPath =
      fileEntry.source === FileEntrySource.remote
        ? getCorrespondingPath(fileEntry.fullPath) || ""
        : fileEntry.fullPath;
    const remotePath =
      fileEntry.source === FileEntrySource.local
        ? getCorrespondingPath(fileEntry.fullPath) || ""
        : fileEntry.fullPath;

    const localEntry =
      fileEntry.source === FileEntrySource.local
        ? fileEntry
        : await listLocalFilesRecursive(localPath);
    const remoteEntry =
      fileEntry.source === FileEntrySource.remote
        ? fileEntry
        : await listRemoteFilesRecursive(remotePath);

    const root = new FileEntry(
      fileEntry.name,
      fileEntry.type,
      fileEntry.size,
      fileEntry.modifiedTime,
      fileEntry.source,
      fileEntry.fullPath,
    );

    await compareEntries(localEntry, remoteEntry, root);

    return root.children.get(root.name) || root;
  } catch (error) {
    console.error("Error:", error);
    return fileEntry;
  }
}
