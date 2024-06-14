import * as vscode from "vscode";
import { getCorrespondingPath } from "./filePathUtils";
import { downloadRemoteFile } from "./sftpOperations";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";

export async function handleFileDownload(fileEntry: any) {
  const configuration =
    WorkspaceConfig.getInstance().getRemoteServerConfigured();

  const remotePath = fileEntry.fullPath;
  const localPath = getCorrespondingPath(remotePath);

  if (!localPath) {
    vscode.window.showErrorMessage(
      `No local folder paired with remote folder: ${remotePath}`,
    );
    return;
  }

  try {
    await downloadRemoteFile(configuration, remotePath, localPath);
    vscode.window.showInformationMessage(`File downloaded to ${localPath}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to download file: ${error.message}`);
  }
}
