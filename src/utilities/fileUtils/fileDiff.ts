import * as path from "path";
import { window, Uri, commands } from "vscode";
import { FileNode } from "../FileNode";
import { downloadRemoteFile } from "./sftpOperations";
import { getCorrespondingPath } from "./filePathUtils";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";

export async function showDiff(fileEntry: FileNode) {
  const configuration = WorkspaceConfig.getRemoteServerConfigured();

  const localFilePath = fileEntry.fullPath;
  const remoteFilePath = getCorrespondingPath(localFilePath);

  if (!remoteFilePath) {
    window.showErrorMessage(`No remote path found for ${localFilePath}`);
    return;
  }

  const tmpDir = path.join(__dirname, "..", "..", "tmp");
  const localTmpPath = path.join(tmpDir, path.basename(remoteFilePath));

  try {
    await downloadRemoteFile(configuration, remoteFilePath, localTmpPath);

    const localUri = Uri.file(localFilePath);
    const remoteUri = Uri.file(localTmpPath);

    await commands.executeCommand(
      "vscode.diff",
      localUri,
      remoteUri,
      "Local ↔ Remote",
    );
  } catch (error: any) {
    window.showErrorMessage(`Error showing diff: ${error.message}`);
  }
}
