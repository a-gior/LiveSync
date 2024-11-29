import * as vscode from "vscode";
import { getFullPaths } from "./filePathUtils";
import { downloadRemoteFile } from "./sftpOperations";
import { ComparisonFileNode } from "../ComparisonFileNode";
import { LOG_FLAGS, logErrorMessage } from "../../services/LogManager";

export async function handleFileDownload(fileEntry: ComparisonFileNode) {
  const { localPath, remotePath } = await getFullPaths(fileEntry);

  if (!remotePath || !localPath) {
    logErrorMessage(
      `No local or remote path found, localPath: ${localPath} / remotePath: ${remotePath}`,
      LOG_FLAGS.ALL,
      fileEntry,
    );
    return;
  }

  try {
    await downloadRemoteFile(remotePath, localPath);
    vscode.window.showInformationMessage(`File downloaded to ${localPath}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to download file: ${error.message}`);
  }
}
