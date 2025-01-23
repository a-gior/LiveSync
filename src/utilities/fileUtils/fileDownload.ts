import * as vscode from "vscode";
import { getFullPaths } from "./filePathUtils";
import { downloadRemoteFile } from "./sftpOperations";
import { ComparisonFileNode } from "../ComparisonFileNode";

export async function handleFileDownload(fileEntry: ComparisonFileNode) {
  const { localPath, remotePath } = await getFullPaths(fileEntry);

  try {
    await downloadRemoteFile(remotePath, localPath);
    vscode.window.showInformationMessage(`File downloaded to ${localPath}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to download file: ${error.message}`);
  }
}
