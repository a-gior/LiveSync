import * as fs from "fs";
import { Uri } from "vscode";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { downloadDirectory, uploadDirectory } from "./directoryOperations";
import { FileEventHandler } from "../../services/FileEventHandler";
import { Action, ActionResult } from "../enums";
import { SyncTreeDataProvider } from "../../services/SyncTreeDataProvider";
import { logErrorMessage } from "../../managers/LogManager";
import JsonManager from "../../managers/JsonManager";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";
import { unlink } from 'fs/promises';
import { getFullPaths } from "./filePathUtils";
import { fileDelete } from "./fileEventFunctions";

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function handleAction(
  input: ComparisonFileNode | Uri | undefined | null,
  action: "upload" | "download",
  treeDataProvider: SyncTreeDataProvider
) {
  // Get the element (root folder or a specific file)
  let element = await resolveElement(input, treeDataProvider);
  if (!element) {return;}

  if (element.isDirectory()) {
    await (action === "upload" ? uploadDirectory(element) : downloadDirectory(element));

    const { localPath, remotePath } = WorkspaceConfigManager.getWorkspaceFullPaths();
    const comparisonFileNode = await treeDataProvider.getComparisonFileNode(localPath, remotePath);

    const updatedNode = await treeDataProvider.updateRootElements(Action.Update, comparisonFileNode);
    await treeDataProvider.refresh(updatedNode);

  } else {
    await (action === "upload"
      ? FileEventHandler.handleFileUpload(element, treeDataProvider)
      : FileEventHandler.handleFileDownload(element, treeDataProvider));
  }
}

async function resolveElement(
  input: ComparisonFileNode | Uri | undefined | null,
  treeDataProvider: SyncTreeDataProvider
): Promise<ComparisonFileNode | null> {
  if (!input) {
    logErrorMessage("No valid element provided.");
    return null;
  }

  if (input instanceof Uri) {
    return await JsonManager.findComparisonNodeFromUri(input, treeDataProvider);
  }

  return input;
}

export function getRootElement(treeDataProvider: SyncTreeDataProvider): ComparisonFileNode | null {
  const rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
  const rootElement = treeDataProvider.rootElements.get(rootFolderName);

  if (!rootElement) {
    logErrorMessage(`Root folder "${rootFolderName}" not found in root entries.`);
    return null;
  }

  if (!rootElement.isDirectory()) {
    logErrorMessage("Root folder is not a directory.");
    return null;
  }

  return rootElement;
}

/**
 * Deletes a file or folder locally or remotely
 */
export async function performDelete(
  node: ComparisonFileNode,
  treeDataProvider: SyncTreeDataProvider
): Promise<void> {
  const isLocal = node.status === ComparisonStatus.added ? true : false;

  // Build the absolute path Uri from the node's relativePath
  const {localPath} = await getFullPaths(node);
  const fileUri = Uri.file(localPath);

  // Perform the correct deletion
  let isDeleted = false;
  if (isLocal) {
    isDeleted = await deleteLocal(fileUri);

  } else {
    const fileDeletedAction = await fileDelete(fileUri);
    isDeleted = fileDeletedAction === ActionResult.ActionPerformed;
  }
 
  if (isDeleted) {
    // Remove node from rootElements
    const deletedNode = await treeDataProvider.updateRootElements(Action.Remove, node);
    await treeDataProvider.refresh(deletedNode);
  }
}

/**
 * Deletes the folder at the given URI locally.
 * @param uri A vscode.Uri pointing to the file to delete
 * @returns true if deletion succeeded, false otherwise
 */
async function deleteLocal(uri: Uri): Promise<boolean> {
  try {
    await rm(uri.fsPath, { recursive: true, force: true });
    return true;
  } catch (err: any) {
    logErrorMessage(`Failed to delete local file/folder ${uri.fsPath}, error: ${err.message}`);
    return false;
  }
}}
