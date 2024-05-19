import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";
import { getLocalPath } from "./filePathUtils";
import { downloadRemoteFile } from "./sftpOperations";

export async function handleFileDownload(fileEntry: any) {
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();
  const pairedFolders: PairFoldersMessage["paths"][] =
    workspaceConfig["pairedFolders"] || [];

  if (!workspaceConfig["configuration"]) {
    vscode.window.showErrorMessage("Remote server not configured");
    return;
  }

  const remotePath = fileEntry.fullPath;
  const localPath = getLocalPath(remotePath, pairedFolders);

  if (!localPath) {
    vscode.window.showErrorMessage(
      `No local folder paired with remote folder: ${remotePath}`,
    );
    return;
  }

  try {
    await downloadRemoteFile(
      workspaceConfig.configuration,
      remotePath,
      localPath,
    );
    vscode.window.showInformationMessage(`File downloaded to ${localPath}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to download file: ${error.message}`);
  }
}
