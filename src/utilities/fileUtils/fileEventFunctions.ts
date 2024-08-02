import { window, commands, Uri } from "vscode";
import { getCorrespondingPath } from "./filePathUtils";
import {
  uploadFile,
  compareRemoteFileHash,
  deleteRemoteFile,
  moveRemoteFile,
} from "./sftpOperations";
import { FileNode } from "../FileNode";
import * as path from "path";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";

const actionOnSave = WorkspaceConfig.getParameter("actionOnSave");
export async function fileSave(uri: Uri) {
  if (actionOnSave !== "none") {
    const localPath = uri.fsPath;
    const remotePath = getCorrespondingPath(localPath);
    if (!remotePath) {
      window.showErrorMessage(
        `No remote folder paired with local folder: ${localPath}`,
      );
      return;
    }

    if (actionOnSave === "check&save" || actionOnSave === "check") {
      const isSame = await compareRemoteFileHash(remotePath);

      if (actionOnSave === "check") {
        window.showInformationMessage(
          `File ${path.basename(localPath)} ${isSame ? "can" : "cant"} be saved.`,
        );
        return;
      }

      if (!isSame) {
        const userResponse = await window.showWarningMessage(
          `The remote file at ${remotePath} has been modified since you last fetched it. Do you want to overwrite it with the local changes?`,
          { modal: true },
          "Yes",
          "Show Diff",
        );

        if (userResponse === "Show Diff") {
          const fileEntry = FileNode.getEntryFromLocalPath(localPath); // Assuming you have this function
          if (fileEntry) {
            commands.executeCommand("livesync.fileEntryShowDiff", fileEntry);
          }
          return;
        } else if (userResponse !== "Yes") {
          window.showInformationMessage("File upload canceled.");
          return;
        }
      }
    }

    await uploadFile(localPath, remotePath);
  }
}

export async function fileMove(oldUri: Uri, newUri: Uri) {
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

    if (actionOnMove === "check&move" || actionOnMove === "check") {
      const isSame = await compareRemoteFileHash(remotePathOld);
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

export async function fileDelete(uri: Uri) {
  const actionOnDelete = WorkspaceConfig.getParameter("actionOnDelete");

  if (actionOnDelete !== "none") {
    const localPath = uri.fsPath;
    const remotePath = getCorrespondingPath(localPath);

    if (!remotePath) {
      window.showErrorMessage(
        `No remote folder paired with local folder: ${localPath}`,
      );
      return;
    }

    if (actionOnDelete === "check&delete" || actionOnDelete === "check") {
      const isSame = await compareRemoteFileHash(remotePath);
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

export async function fileCreate(uri: Uri) {
  const actionOnCreate = WorkspaceConfig.getParameter("actionOnCreate");

  if (actionOnCreate !== "none") {
    const localPath = uri.fsPath;
    const remotePath = getCorrespondingPath(localPath);

    if (!remotePath) {
      window.showErrorMessage(
        `No remote folder paired with local folder: ${localPath}`,
      );
      return;
    }

    if (actionOnCreate === "check&create" || actionOnCreate === "check") {
      const isSame = await compareRemoteFileHash(remotePath);
      if (actionOnCreate === "check") {
        window.showInformationMessage(
          `File ${path.basename(localPath)} ${isSame ? "can" : "cant"} be created.`,
        );
        return;
      }
      if (isSame) {
        window.showInformationMessage(
          `File ${localPath} already exists on remote ${remotePath}`,
        );
        return;
      }
    }

    await uploadFile(localPath, remotePath);
    window.showInformationMessage(
      `File ${localPath} created on remote ${remotePath}`,
    );
  }
}
