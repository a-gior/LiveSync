import * as fs from "fs";
import { rm } from 'fs/promises';
import { Uri } from "vscode";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { downloadDirectory, uploadDirectory } from "./directoryOperations";
import { FileEventHandler } from "../../services/FileEventHandler";
import { Action, ActionOn, ActionResult } from "../enums";
import { SyncTreeDataProvider } from "../../services/SyncTreeDataProvider";
import { logErrorMessage } from "../../managers/LogManager";
import { getFullPaths, getRelativePath } from "./filePathUtils";
import { fileDelete } from "./fileEventFunctions";
import { FileNodeSource } from "../FileNode";

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function handleAction(
  element: ComparisonFileNode | Uri | undefined | null,
  action: "upload" | "download",
  treeDataProvider: SyncTreeDataProvider
) {
  // Get the element (root folder or a specific file)
  if (!element) {return;}

  
  if(element instanceof Uri) {
    const workspaceConfig = treeDataProvider.currentWorkspaceConfig;
    const relativePath = getRelativePath(element.fsPath, FileNodeSource.local);
    const comparisonNode = workspaceConfig.jsonStore.findComparisonNode(relativePath);
    element = comparisonNode;
  }

  const { localPath, remotePath} = await getFullPaths(element);

  if (element.isDirectory()) {
    if(action === "upload") {
      await uploadDirectory(element);
    } else {
      await downloadDirectory(element);
    }
    
    const comparisonFileNode = await treeDataProvider.getComparisonFileNode(localPath, remotePath);

    FileEventHandler.updateNodeStatus(comparisonFileNode, action === "upload" ? ActionOn.Upload : ActionOn.Download, ActionResult.ActionPerformed);
    const updatedNode = await treeDataProvider.updateStore(Action.Update, comparisonFileNode);
    await treeDataProvider.refresh(updatedNode);

  } else {
    await (action === "upload"
      ? FileEventHandler.handleFileUpload(element, treeDataProvider)
      : FileEventHandler.handleFileDownload(element, treeDataProvider));
  }
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
    const deletedNode = await treeDataProvider.updateStore(Action.Remove, node);
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
}
