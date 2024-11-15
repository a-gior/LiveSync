import { window, commands, Uri } from "vscode";
import { getCorrespondingPath, getFullPaths } from "./filePathUtils";
import {
  uploadFile,
  compareRemoteFileHash,
  deleteRemoteFile,
  moveRemoteFile,
} from "./sftpOperations";
import { FileNode } from "../FileNode";
import * as path from "path";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";
import FileNodeManager from "../../services/FileNodeManager";
import { PairedFoldersTreeDataProvider } from "../../services/PairedFoldersTreeDataProvider";
import { LOG_FLAGS, logErrorMessage } from "../../services/LogManager";

async function handleFileAction(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
  actionParameter: string,
) {
  if (actionParameter === "none") {
    return; // If no action is needed, stop here
  }

  const localPath = uri.fsPath;
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
    return;
  }

  const { remotePath } = await getFullPaths(comparisonNode);
  if (!remotePath) {
    logErrorMessage(`File ${remotePath} is not found.`);
    return;
  }

  // "check&save" or "check" - Perform the comparison
  if (actionParameter.includes("check")) {
    const isSame = await compareRemoteFileHash(comparisonNode);

    if (actionParameter === "check") {
      window.showInformationMessage(
        `File ${path.basename(localPath)} ${isSame ? "can" : "cannot"} be processed.`,
      );
      return; // Only perform a check, don't proceed further
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
        return;
      } else if (userResponse !== "Yes") {
        window.showInformationMessage("File upload canceled.");
        return;
      }
    }
  }

  // Upload or Save the file if no discrepancies or user confirmed to overwrite
  await uploadFile(localPath, remotePath);
}

export async function fileSave(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
) {
  const actionOnSave = WorkspaceConfig.getParameter("actionOnSave") ?? "none";
  await handleFileAction(uri, treeDataProvider, actionOnSave);
}

export async function fileUpload(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
) {
  const actionOnUpload =
    WorkspaceConfig.getParameter("actionOnUpload") ?? "none";
  await handleFileAction(uri, treeDataProvider, actionOnUpload);
}

export async function fileMove(
  oldUri: Uri,
  newUri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();
  const actionOnMove = WorkspaceConfig.getParameter("actionOnMove");

  if (actionOnMove !== "none") {
    const localPathOld = oldUri.fsPath;
    const localPathNew = newUri.fsPath;
    const remotePathOld = getCorrespondingPath(localPathOld);
    const remotePathNew = getCorrespondingPath(localPathNew);

    if (!remotePathOld || !remotePathNew) {
      window.showErrorMessage(
        `No remote folder paired with local folder: ${localPathOld} or ${localPathNew}`,
      );
      return;
    }

    const comparisonNode = await FileNodeManager.findEntryByPath(
      remotePathOld,
      treeDataProvider.rootElements,
    );
    if (!comparisonNode) {
      window.showErrorMessage(
        `File ${remotePathOld} is not tracked in comparison JSON.`,
      );
      return;
    }

    if (actionOnMove === "check&move" || actionOnMove === "check") {
      const isSame = await compareRemoteFileHash(comparisonNode);
      if (actionOnMove === "check") {
        window.showInformationMessage(
          `File ${path.basename(localPathOld)} ${isSame ? "can" : "cant"} be moved.`,
        );
        return;
      }
      if (!isSame) {
        const userResponse = await window.showWarningMessage(
          `The remote file at ${remotePathOld} has been modified since you last fetched it. Do you want to overwrite it with the local changes?`,
          { modal: true },
          "Yes",
          "Show Diff",
        );

        if (userResponse === "Show Diff") {
          const fileEntry = FileNode.getEntryFromLocalPath(localPathOld); // Assuming you have this function
          if (fileEntry) {
            commands.executeCommand("livesync.fileEntryShowDiff", fileEntry);
          }
          return;
        } else if (userResponse !== "Yes") {
          window.showInformationMessage("File move canceled.");
          return;
        }
      }
    }

    await moveRemoteFile(configuration, remotePathOld, remotePathNew);
    window.showInformationMessage(
      `File ${localPathOld} moved to ${localPathNew} and synced to remote.`,
    );
  }
}

export async function fileDelete(
  uri: Uri,
  treeDataProvider: PairedFoldersTreeDataProvider,
) {
  const actionOnDelete = WorkspaceConfig.getParameter("actionOnDelete");

  if (actionOnDelete !== "none") {
    const localPath = uri.fsPath;
    const remotePath = getCorrespondingPath(localPath);

    const comparisonNode = await FileNodeManager.findEntryByPath(
      localPath,
      treeDataProvider.rootElements,
    );
    if (!comparisonNode) {
      window.showErrorMessage(
        `File ${localPath} is not tracked in comparison JSON.`,
      );
      return;
    }

    if (!remotePath) {
      window.showErrorMessage(
        `No remote folder paired with local folder: ${localPath}`,
      );
      return;
    }

    if (actionOnDelete === "check&delete" || actionOnDelete === "check") {
      const isSame = await compareRemoteFileHash(comparisonNode);
      if (actionOnDelete === "check") {
        window.showInformationMessage(
          `File ${path.basename(localPath)} ${isSame ? "can" : "cant"} be deleted.`,
        );
        return;
      }
      if (!isSame) {
        const userResponse = await window.showWarningMessage(
          `The remote file at ${remotePath} has been modified since you last fetched it. It may not be safe to delete it. Do you still want to delete it ?`,
          { modal: true },
          "Yes",
        );

        if (userResponse !== "Yes") {
          window.showInformationMessage("File upload canceled.");
          return;
        }
      }
    }

    await deleteRemoteFile(remotePath);
    window.showInformationMessage(
      `File ${localPath} deleted from remote ${remotePath}.`,
    );
  }
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
