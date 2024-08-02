import { FileNode, FileNodeSource } from "../FileNode";
import { workspace } from "vscode";
import { getCorrespondingPath } from "./filePathUtils";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "./fileListing";
import {
  LOG_FLAGS,
  logErrorMessage,
  logInfoMessage,
} from "../../services/LogManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { BaseNodeType } from "../BaseNode";

async function compareEntries(
  localEntry: FileNode | undefined,
  remoteEntry: FileNode | undefined,
  parent: FileNode,
): Promise<void> {
  const showUnchanged = workspace
    .getConfiguration("LiveSync")
    .get<boolean>("showUnchanged", true);

  // Helper function to handle adding child entries
  const addChildEntries = async (
    parentEntry: FileNode,
    entries: Map<string, FileNode>,
    isLocal: boolean,
  ) => {
    for (const child of entries.values()) {
      const newEntry = new FileNode(
        child.name,
        child.type,
        child.size,
        child.modifiedTime,
        child.fullPath,
        child.source,
      );
      newEntry.updateStatus(
        isLocal ? FileNodeStatus.added : FileNodeStatus.removed,
      );
      parentEntry.addChild(newEntry);
      await compareEntries(
        isLocal ? child : undefined,
        isLocal ? undefined : child,
        newEntry,
      );
    }
    updateDirectoryStatusBasedOnChildren(parentEntry);
  };

  // Handle cases where one of the entries is undefined
  if (!localEntry && remoteEntry) {
    await addChildEntries(remoteEntry, remoteEntry.children, false);
    parent.addChild(remoteEntry);
    return;
  }

  if (localEntry && !remoteEntry) {
    await addChildEntries(localEntry, localEntry.children, true);
    parent.addChild(localEntry);
    return;
  }

  if (localEntry && remoteEntry) {
    const currentEntry = new FileNode(
      localEntry.name,
      localEntry.type,
      localEntry.size,
      localEntry.modifiedTime,
      localEntry.source,
      localEntry.fullPath,
    );

    if (
      localEntry.type === FileNodeType.file &&
      remoteEntry.type === FileNodeType.file
    ) {
      if (localEntry.hash !== remoteEntry.hash) {
        currentEntry.updateStatus(FileNodeStatus.modified);
        parent.updateStatus(FileNodeStatus.modified);
        logInfoMessage(
          `File modified: ${currentEntry.fullPath}`,
          LOG_FLAGS.CONSOLE_ONLY,
        );
      } else {
        currentEntry.updateStatus(FileNodeStatus.unchanged);
      }
    } else {
      currentEntry.updateStatus(FileNodeStatus.unchanged);
    }

    if (
      !(
        showUnchanged === false &&
        currentEntry.status === FileNodeStatus.unchanged
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
function updateDirectoryStatusBasedOnChildren(
  currentEntry: ComparisonFileNode,
) {
  let previousStatus: ComparisonStatus | undefined = undefined;
  let isConsistent = true;

  // Iterate over the children and track their statuses
  for (const child of currentEntry.children.values()) {
    if (!child.status) {
      logErrorMessage(
        `[updateDirectoryStatusBasedOnChildren] CurrentEntry (${currentEntry.name}) child ${child.name} parameter has no status`,
        LOG_FLAGS.CONSOLE_ONLY,
      );
      return;
    }

    if (child.status === ComparisonStatus.modified) {
      currentEntry.setStatus(ComparisonStatus.modified);
      return; // Early exit on first modified status
    }

    if (previousStatus === undefined) {
      previousStatus = child.status;
    } else if (previousStatus !== child.status) {
      isConsistent = false;
    }
  }

  if (isConsistent) {
    currentEntry.setStatus(ComparisonStatus.unchanged);
  } else {
    currentEntry.setStatus(ComparisonStatus.modified);
  }
}

export async function compareLocalAndRemote(
  localRoot: FileNode,
  remoteRoot: FileNode,
): Promise<Map<string, FileNode>> {
  const root = new FileNode(
    localRoot.name,
    BaseNodeType.directory,
    localRoot.size,
    localRoot.modifiedTime,
    localRoot.fullPath,
    localRoot.source,
  );
  await compareEntries(localRoot, remoteRoot, root);
  return root.children;
}

export async function compareCorrespondingEntry(
  fileEntry: FileNode,
): Promise<FileNode> {
  try {
    const localPath =
      fileEntry.source === FileNodeSource.remote
        ? getCorrespondingPath(fileEntry.fullPath) || ""
        : fileEntry.fullPath;
    const remotePath =
      fileEntry.source === FileNodeSource.local
        ? getCorrespondingPath(fileEntry.fullPath) || ""
        : fileEntry.fullPath;

    const localEntry =
      fileEntry.source === FileNodeSource.local
        ? fileEntry
        : await listLocalFilesRecursive(localPath);
    const remoteEntry =
      fileEntry.source === FileNodeSource.remote
        ? fileEntry
        : await listRemoteFilesRecursive(remotePath);

    const root = new FileNode(
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
