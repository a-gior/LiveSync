import * as fs from "fs";
import { Uri } from "vscode";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { downloadDirectory, uploadDirectory } from "./directoryOperations";
import { FileEventHandler } from "../../services/FileEventHandler";
import { Action } from "../enums";
import { SyncTreeDataProvider } from "../../services/SyncTreeDataProvider";
import { logErrorMessage } from "../../managers/LogManager";
import JsonManager from "../../managers/JsonManager";
import { WorkspaceConfigManager } from "../../managers/WorkspaceConfigManager";

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
    ComparisonFileNode.setComparisonStatus(element, ComparisonStatus.unchanged);
  } else {
    await (action === "upload"
      ? FileEventHandler.handleFileUpload(element, treeDataProvider)
      : FileEventHandler.handleFileDownload(element, treeDataProvider));
  }

  const updatedNode = await treeDataProvider.updateRootElements(Action.Update, element);
  await treeDataProvider.refresh(updatedNode);
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

export async function getRootElement(treeDataProvider: SyncTreeDataProvider): Promise<ComparisonFileNode | null> {
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
