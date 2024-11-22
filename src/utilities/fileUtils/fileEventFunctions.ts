import { window, commands, Uri } from "vscode";
import { getCorrespondingPath } from "./filePathUtils";
import {
  uploadFile,
  compareRemoteFileHash,
  deleteRemoteFile,
  moveRemoteFile,
} from "./sftpOperations";
import * as path from "path";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import FileNodeManager from "../../services/FileNodeManager";
import { PairedFoldersTreeDataProvider } from "../../services/PairedFoldersTreeDataProvider";
import { LOG_FLAGS, logErrorMessage } from "../../services/LogManager";

async function handleFileAction(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
  actionParameter: string,
): Promise<Boolean> {
  if (actionParameter === "none") {
    return false; // If no action is needed, stop here
  }

  const localPath = uri.fsPath;
  const remotePath = getCorrespondingPath(localPath);
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

  // "check&save" or "check" - Perform the comparison
  if (actionParameter.includes("check")) {
    const isSame = await compareRemoteFileHash(comparisonNode);

    if (actionParameter === "check") {
      window.showInformationMessage(
        `File ${path.basename(localPath)} ${isSame ? "can" : "cannot"} be processed.`,
      );
      return false; // Only perform a check, don't proceed further
    }

    // If hash differs, ask the user for confirmation
    if (!isSame) {
      const userResponse = await window.showWarningMessage(
        `The remote file at ${remotePath} has been modified. Do you want to overwrite it with the local changes?`,
        { modal: true },
        "Yes",
        "Show Diff",
      );

      if (userResponse === "Show Diff") {
        // Show diff if requested
        commands.executeCommand("livesync.fileEntryShowDiff", comparisonNode);
        return false;
      } else if (userResponse !== "Yes") {
        window.showInformationMessage("File upload canceled.");
        return false;
      }
    }
  }

  // Upload or Save the file if no discrepancies or user confirmed to overwrite
  await uploadFile(localPath, remotePath);
  return true;
}

export async function fileSave(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
) {
  const actionOnSave = WorkspaceConfig.getParameter("actionOnSave") ?? "none";
  return await handleFileAction(uri, treeDataProvider, actionOnSave);
}

export async function fileUpload(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
) {
  const actionOnUpload =
    WorkspaceConfig.getParameter("actionOnUpload") ?? "none";
  return await handleFileAction(uri, treeDataProvider, actionOnUpload);
}

export async function fileMove(oldUri: Uri, newUri: Uri): Promise<boolean> {
  const actionOnMove = WorkspaceConfig.getParameter("actionOnMove");

  if (actionOnMove !== "none") {
    const localPathOld = oldUri.fsPath;
    const localPathNew = newUri.fsPath;
    const remotePathOld = getCorrespondingPath(localPathOld);
    const remotePathNew = getCorrespondingPath(localPathNew);

    await moveRemoteFile(remotePathOld, remotePathNew);
    window.showInformationMessage(`File move to remote at ${remotePathNew}`);
    return true;
  }

  return false;
}

export async function fileDelete(uri: Uri): Promise<boolean> {
  const actionOnDelete = WorkspaceConfig.getParameter("actionOnDelete");

  if (actionOnDelete !== "none") {
    const localPath = uri.fsPath;
    const remotePath = getCorrespondingPath(localPath);

    await deleteRemoteFile(remotePath);
    window.showInformationMessage(`File deleted on remote ${remotePath}`);
    return true;
  }

  return false;
}

export async function fileCreate(uri: Uri): Promise<boolean> {
  const actionOnCreate = WorkspaceConfig.getParameter("actionOnCreate");

  if (actionOnCreate !== "none") {
    const localPath = uri.fsPath;
    const remotePath = getCorrespondingPath(localPath);

    await uploadFile(localPath, remotePath);
    window.showInformationMessage(
      `File ${localPath} created on remote ${remotePath}`,
    );
    return true;
  }

  return false;
}
