import * as path from "path";
import { window, Uri, commands } from "vscode";
import { downloadRemoteFile } from "./sftpOperations";
import { getFullPaths } from "./filePathUtils";
import { ComparisonFileNode } from "../ComparisonFileNode";

export async function showDiff(fileNode: ComparisonFileNode) {
  const { localPath, remotePath } = await getFullPaths(fileNode);

  if (!localPath || !remotePath) {
    window.showErrorMessage(
      `No local or remote path found for ${fileNode.relativePath}`,
    );
    return;
  }

  const tmpDir = path.join(__dirname, "..", "..", "tmp");
  const localTmpPath = path.join(tmpDir, path.basename(remotePath));

  try {
    await downloadRemoteFile(remotePath, localTmpPath);

    const localUri = Uri.file(localPath);
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
