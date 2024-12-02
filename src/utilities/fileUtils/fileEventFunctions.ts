import { window, commands, Uri } from "vscode";
import { getCorrespondingPath, pathExists } from "./filePathUtils";
import {
  uploadRemoteFile,
  compareRemoteFileHash,
  deleteRemoteFile,
  moveRemoteFile,
  downloadRemoteFile,
} from "./sftpOperations";
import * as path from "path";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import FileNodeManager from "../../services/FileNodeManager";
import { PairedFoldersTreeDataProvider } from "../../services/PairedFoldersTreeDataProvider";
import {
  LOG_FLAGS,
  logErrorMessage,
  logInfoMessage,
} from "../../services/LogManager";
import { FileNodeSource } from "../FileNode";
import { listRemoteFilesRecursive } from "./fileListing";

enum Check {
  remoteExists = "remoteExists",
  remoteNotExists = "remoteNotExists",
  remoteNotSame = "remoteNotSame",
  localExists = "localExists",
}

function getCheckMessage(check: Check, path: string): string {
  switch (check) {
    case Check.remoteExists:
      return `The remote file at ${path} already exists. Do you want to overwrite it with the local changes?`;
    case Check.remoteNotExists:
      return `The remote file at ${path} does not exist.`;
    case Check.remoteNotSame:
      return `The remote file at ${path} has been modified. Do you want to overwrite it with the local changes?`;
    case Check.localExists:
      return `The local file at ${path} already exists. Do you want to overwrite it with the remote file?`;
    default:
      return "";
  }
}

// Prompts the user when a remote file already exists, offering options to overwrite, show differences, or cancel.
async function showOverwritePrompt(
  check: Check,
  remotePath: string,
  localPath: string,
  comparisonNode: any = null,
) {
  const userResponse = await window.showWarningMessage(
    getCheckMessage(check, remotePath),
    { modal: true },
    "Yes",
    "Show Diff",
  );
  if (userResponse === "Show Diff") {
    if (comparisonNode) {
      commands.executeCommand("livesync.fileEntryShowDiff", comparisonNode);
    } else {
      commands.executeCommand("livesync.fileEntryShowDiff", {
        localPath,
        remotePath,
      });
    }
    return false;
  } else if (userResponse !== "Yes") {
    logInfoMessage("Operation canceled.");
    return false;
  }
  return true;
}

// Checks if a remote file exists, with different behavior based on the action type.
async function checkRemoteFileExistence(action: string, remotePath: string) {
  const exists = await pathExists(remotePath, FileNodeSource.remote);

  // For delete actions, the file must exist remotely.
  if (action === "actionOnDelete") {
    if (!exists) {
      logInfoMessage(getCheckMessage(Check.remoteNotExists, remotePath));
      return false;
    }
    return true;
  }

  // For other actions, return true if the file exists.
  return exists;
}

// Checks if a local file exists, with different behavior based on the action type.
async function checkLocalFileExistence(action: string, localPath: string) {
  const exists = await pathExists(localPath, FileNodeSource.local);

  // For download actions, the file must exist locally before prompting the user.
  if (action === "actionOnDownload" && exists) {
    const userResponse = await window.showWarningMessage(
      getCheckMessage(Check.localExists, localPath),
      { modal: true },
      "Yes",
      "Cancel",
    );
    if (userResponse !== "Yes") {
      logInfoMessage("Download operation canceled.");
      return false;
    }
  }

  return true;
}

// Update the JSON of remote files
async function updateRemoteFilesJsonForPaths(...filePaths: string[]) {
  const fileNodeManager = FileNodeManager.getInstance();

  for (const filePath of filePaths) {
    if (filePath) {
      // Get the parent directory of the provided file path
      const parentDirPath = path.dirname(filePath);

      // List the files recursively in the parent directory and update the JSON
      const remoteFileNode = await listRemoteFilesRecursive(parentDirPath);
      if (remoteFileNode) {
        await fileNodeManager.updateRemoteFilesJson(remoteFileNode);
        logInfoMessage(`Updated JSON Remote files for ${parentDirPath}`);
      } else {
        logErrorMessage(`Couldnt find remote file node at ${parentDirPath}`);
      }
    }
  }
}

// Handles the checking process before performing an action, including hash comparison and existence checks.
async function handleFileCheck(
  action: string,
  actionParameter: string,
  localPath: string,
  remotePath: string,
  comparisonNode: any = null,
) {
  if (actionParameter.includes("check")) {
    if (comparisonNode) {
      // Perform a hash check if comparisonNode is provided.
      const isSame = await compareRemoteFileHash(remotePath);
      if (actionParameter === "check") {
        logInfoMessage(
          `File ${path.basename(localPath)} ${isSame ? "can" : "cannot"} be processed.`,
        );
        return false;
      }
      if (!isSame) {
        return await showOverwritePrompt(
          Check.remoteNotSame,
          remotePath,
          localPath,
          comparisonNode,
        );
      }
    } else {
      // If no comparisonNode, check if the remote file exists.
      const exists = await checkRemoteFileExistence(action, remotePath);
      if (exists && action !== "actionOnDelete") {
        return await showOverwritePrompt(
          Check.remoteExists,
          remotePath,
          localPath,
        );
      }
    }
  }

  // For download actions, check if the local file exists before proceeding
  if (action === "actionOnDownload" && actionParameter.includes("check")) {
    return await checkLocalFileExistence(action, localPath);
  }

  return true;
}

// This function orchestrates the different file operations (e.g., move, save, delete).
// It determines the correct action to perform based on the provided parameters and handles all necessary checks before proceeding.
async function handleFileOperation(
  action: string,
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider | null = null,
  oldUri: Uri | null = null,
): Promise<boolean> {
  const localPath = uri.fsPath;
  const remotePath = getCorrespondingPath(localPath);
  let actionParameter = WorkspaceConfig.getParameter<string>(action) ?? "none";

  // Handle move operation
  if (action === "actionOnMove" && oldUri) {
    const localPathOld = oldUri.fsPath;
    const remotePathOld = getCorrespondingPath(localPathOld);
    if (
      await handleFileCheck(action, actionParameter, localPathOld, remotePath)
    ) {
      await moveRemoteFile(remotePathOld, remotePath);
      logInfoMessage(`File moved to remote at ${remotePath}`, LOG_FLAGS.ALL);

      await updateRemoteFilesJsonForPaths(remotePathOld, remotePath);

      // After the file is moved, any references to the old file path should be updated, and any additional cleanup or re-indexing tasks should be performed as needed.
      return true;
    }
    return false;
  }

  // Handle save and upload operations
  if (
    treeDataProvider &&
    (action === "actionOnSave" || action === "actionOnUpload")
  ) {
    // The comparisonNode is needed to determine if the file is tracked in the comparison JSON.
    // It helps to identify if the current file has an associated entry in the synced state, which is used to perform operations like hash comparison.
    const comparisonNode = await FileNodeManager.findEntryByPath(
      localPath,
      treeDataProvider.rootElements,
    );
    if (!comparisonNode) {
      logErrorMessage(
        `File ${localPath} is not tracked in comparison JSON.`,
        LOG_FLAGS.ALL,
        treeDataProvider.rootElements,
      );
      return false;
    }
    if (
      await handleFileCheck(
        action,
        actionParameter,
        localPath,
        remotePath,
        comparisonNode,
      )
    ) {
      await uploadRemoteFile(localPath, remotePath);
      logInfoMessage(`File uploaded to remote at ${remotePath}`, LOG_FLAGS.ALL);

      await updateRemoteFilesJsonForPaths(remotePath);
      return true;
    }
    return false;
  }

  // Handle create, delete, and download operations
  if (await handleFileCheck(action, actionParameter, localPath, remotePath)) {
    if (action === "actionOnDelete") {
      await deleteRemoteFile(remotePath);
      logInfoMessage(`File deleted on remote at ${remotePath}`, LOG_FLAGS.ALL);

      await updateRemoteFilesJsonForPaths(remotePath);
    } else if (action === "actionOnDownload") {
      await downloadRemoteFile(remotePath, localPath);
      logInfoMessage(
        `File downloaded from remote at ${remotePath}`,
        LOG_FLAGS.ALL,
      );
    } else {
      await uploadRemoteFile(localPath, remotePath);
      logInfoMessage(`File uploaded to remote at ${remotePath}`, LOG_FLAGS.ALL);

      await updateRemoteFilesJsonForPaths(remotePath);
    }
    return true;
  }
  return false;
}

export async function fileSave(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
): Promise<boolean> {
  return await handleFileOperation("actionOnSave", uri, treeDataProvider);
}

export async function fileCreate(uri: Uri): Promise<boolean> {
  return await handleFileOperation("actionOnCreate", uri);
}

export async function fileDelete(uri: Uri): Promise<boolean> {
  return await handleFileOperation("actionOnDelete", uri);
}

export async function fileMove(oldUri: Uri, newUri: Uri): Promise<boolean> {
  return await handleFileOperation("actionOnMove", newUri, null, oldUri);
}

export async function fileUpload(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
): Promise<boolean> {
  return await handleFileOperation("actionOnUpload", uri, treeDataProvider);
}

export async function fileDownload(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
): Promise<boolean> {
  return await handleFileOperation("actionOnDownload", uri, treeDataProvider);
}
