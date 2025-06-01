import { window, commands, Uri } from "vscode";
import { getCorrespondingPath, normalizePath, pathExists } from "./filePathUtils";
import { uploadRemoteFile, compareRemoteFileHash, deleteRemoteFile, moveRemoteFile, downloadRemoteFile } from "./sftpOperations";
import * as path from "path";
import JsonManager from "../../managers/JsonManager";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "../../managers/LogManager";
import { FileNodeSource } from "../FileNode";
import { listRemoteFiles } from "./fileListing";
import { ActionOn, ActionResult, Check } from "../enums";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";

function getPromptMessage(check: Check, localPath: string, remotePath: string): string {
  switch (check) {
    case Check.remoteExists:
      return `The remote file at ${remotePath} already exists. Do you want to overwrite it with the local changes?`;
    case Check.remoteExistsDelete:
      return `The remote file at ${remotePath} has been modified. Do you still want to delete it ?`;
    case Check.remoteNotSameOverwrite:
      return `The remote file at ${remotePath} has been modified. Do you want to overwrite it with the local changes?`;
    case Check.remoteNotSameDownload:
      return `The remote file at ${remotePath} has been modified. Do you want to download the remote file?`;
    case Check.localExists:
      return `The local file at ${localPath} already exists. Do you want to overwrite it with the remote file?`;
    default:
      return "";
  }
}

function getCheckMessage(action: ActionOn, filePath: string): string {
  const fileName = path.basename(filePath);
  switch (action) {
    case ActionOn.Upload:
      return `??`;
    case ActionOn.Download:
      return `File ${fileName} already exists locally`;

    case ActionOn.Save:
    case ActionOn.Open:
      return `File ${fileName} has been modified on the remote server`;
    case ActionOn.Create:
    case ActionOn.Move:
      return `File ${fileName} already exists on the remote server`;
    case ActionOn.Delete:
      return `File ${fileName} doesn't exist on the remote server`;
  }
}

// Prompts the user, offering options to overwrite, show differences, or cancel.
async function showOverwritePrompt(checkMessage: Check, localPath: string, remotePath: string, showDiff: boolean = false) {
  // Set Options, add ShowDiff button depending on showDiff boolean
  const options = ["Yes"];
  if (showDiff) {
    options.push("Show Diff");
  }

  // Prompt the user
  const userResponse = await window.showWarningMessage(getPromptMessage(checkMessage, localPath, remotePath), { modal: true }, ...options);

  // Return action depending on user's choice
  if (userResponse === "Show Diff") {
    commands.executeCommand("livesync.showDiff", {
      localPath,
      remotePath
    });
    return ActionResult.IsNotSame;
  } else if (userResponse !== "Yes") {
    logInfoMessage("Operation canceled.");
    return ActionResult.IsNotSame;
  }

  return ActionResult.ActionPerformed;
}

// Checks if a remote file exists
async function checkRemoteFileExistence(remotePath: string) {
  const exists = await pathExists(remotePath, FileNodeSource.remote);

  return exists ? ActionResult.Exists : ActionResult.DontExist;
}

// Checks if a local file exists
async function checkLocalFileExistence(localPath: string) {
  const exists = await pathExists(localPath, FileNodeSource.local);

  return exists ? ActionResult.Exists : ActionResult.DontExist;
}

// Update the JSON of remote files
async function updateRemoteFilesJsonForPaths(...filePaths: string[]) {
  const fileNodeManager = JsonManager.getInstance();

  for (const filePath of filePaths) {
    if (filePath) {
      // Get the parent directory of the provided file path
      const parentDirPath = path.dirname(filePath);

      // List the files recursively in the parent directory and update the JSON
      const remoteFileNode = await listRemoteFiles(parentDirPath);
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
export async function handleFileCheck(action: ActionOn, actionParameter: string, localPath: string, remotePath: string) {
  // If no check are required, we proceed to do the action
  if (!actionParameter.includes("check")) {
    return ActionResult.ActionPerformed;
  }

  // For download actions, check if the local file exists before proceeding
  if (action === ActionOn.Download) {
    const actionResult = await checkLocalFileExistence(localPath);

    if (actionResult === ActionResult.Exists) {
      // Strict check
      if (actionParameter === "check") {
        logInfoMessage(getCheckMessage(action, remotePath));
        return actionResult;
      }

      // Prompt user to perform action or not
      return await showOverwritePrompt(Check.localExists, localPath, remotePath);
    }

    return ActionResult.ActionPerformed;
  }

  // Check if remote file exists remotely
  const actionResult = await checkRemoteFileExistence(remotePath);

  // Perform a hash check between remote file saved in JSON and remotely
  const isSameRemoteHash = await compareRemoteFileHash(remotePath);

  // Strict check
  if (actionParameter === "check") {
    switch (action) {
      // Show check message if file exists remotely and has different hash
      case ActionOn.Upload:
      case ActionOn.Save:
      case ActionOn.Open:
        if (actionResult === ActionResult.Exists && !isSameRemoteHash) {
          logInfoMessage(getCheckMessage(action, remotePath));
        }
        break;
      // Show check message if file already exists on the remote server
      case ActionOn.Create:
      case ActionOn.Move:
        if (actionResult === ActionResult.Exists) {
          logInfoMessage(getCheckMessage(action, remotePath));
        }
        break;
      // Show check message if file doesn't exists on the remote server
      case ActionOn.Delete:
        if (actionResult === ActionResult.DontExist) {
          logInfoMessage(getCheckMessage(action, remotePath));
        }
        break;
    }
  } else {
    // Show prompt to take action or not
    switch (action) {
      case ActionOn.Upload:
      case ActionOn.Save:
        if (actionResult === ActionResult.Exists && !isSameRemoteHash) {
          return await showOverwritePrompt(Check.remoteNotSameOverwrite, localPath, remotePath, true);
        }

        return ActionResult.ActionPerformed;

      case ActionOn.Open:
        if (actionResult === ActionResult.Exists && !isSameRemoteHash) {
          return await showOverwritePrompt(Check.remoteNotSameDownload, localPath, remotePath);
        }
        break;

      case ActionOn.Create:
      case ActionOn.Move:
        if (actionResult === ActionResult.Exists) {
          return await showOverwritePrompt(Check.remoteExists, localPath, remotePath);
        }

        return ActionResult.ActionPerformed; // File dont exist on remote so we can perform action safely

      case ActionOn.Delete:
        if (actionResult === ActionResult.Exists && !isSameRemoteHash) {
          return await showOverwritePrompt(Check.remoteExistsDelete, localPath, remotePath);
        }

        if (actionResult === ActionResult.Exists && isSameRemoteHash) {
          return ActionResult.ActionPerformed;
        }
        break;
    }
  }

  // Remote file dont exist, so we can perform action without worries
  if (actionResult === ActionResult.DontExist) {
    return ActionResult.DontExist;
  }

  return isSameRemoteHash ? ActionResult.Exists : ActionResult.IsNotSame;
}

// This function orchestrates the different file operations (e.g., move, save, delete).
// It determines the correct action to perform based on the provided parameters and handles all necessary checks before proceeding.
async function handleFileOperation(action: ActionOn, uri: Uri, oldUri: Uri | null = null): Promise<ActionResult> {
  let actionParameter = WorkspaceConfigManager.getParameter<string>(action) ?? "none";
  if (actionParameter === "none") {
    const opName =  action.replace(/^actionOn/, '');
    logInfoMessage( `Skipping ${opName} due to 'none' parameter.`, LOG_FLAGS.ALL);
    return ActionResult.NoAction;
  }

  // Get local and remote path from Uri
  const localPath = normalizePath(uri.fsPath);
  const remotePath = getCorrespondingPath(localPath);

  // Handle check based on action parameters
  const actionResult = await handleFileCheck(action, actionParameter, localPath, remotePath);

  // Perform actions for each action
  if (actionResult === ActionResult.ActionPerformed) {
    switch (action) {
      case ActionOn.Move:
        if (oldUri) {
          const localPathOld = oldUri.fsPath;
          const remotePathOld = getCorrespondingPath(localPathOld);
          await moveRemoteFile(remotePathOld, remotePath);
        }
        break;

      case ActionOn.Upload:
      case ActionOn.Save:
      case ActionOn.Create:
        await uploadRemoteFile(localPath, remotePath);
        break;

      case ActionOn.Download:
      case ActionOn.Open:
        await downloadRemoteFile(remotePath, localPath);
        break;

      case ActionOn.Delete:
        await deleteRemoteFile(remotePath);
        break;
    }

    // Update JSON Remote Files
    await updateRemoteFilesJsonForPaths(remotePath);
  }

  return actionResult;
}

export async function fileSave(uri: Uri): Promise<ActionResult> {
  return await handleFileOperation(ActionOn.Save, uri);
}

export async function fileCreate(uri: Uri): Promise<ActionResult> {
  return await handleFileOperation(ActionOn.Create, uri);
}

export async function fileDelete(uri: Uri): Promise<ActionResult> {
  return await handleFileOperation(ActionOn.Delete, uri);
}

export async function fileMove(oldUri: Uri, newUri: Uri): Promise<ActionResult> {
  return await handleFileOperation(ActionOn.Move, newUri, oldUri);
}

export async function fileOpen(uri: Uri): Promise<ActionResult> {
  return await handleFileOperation(ActionOn.Open, uri);
}

export async function fileUpload(uri: Uri): Promise<ActionResult> {
  return await handleFileOperation(ActionOn.Upload, uri);
}

export async function fileDownload(uri: Uri): Promise<ActionResult> {
  return await handleFileOperation(ActionOn.Download, uri);
}
