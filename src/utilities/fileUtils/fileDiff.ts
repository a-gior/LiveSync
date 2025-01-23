import * as path from "path";
import { window, Uri, commands } from "vscode";
import { downloadRemoteFile } from "./sftpOperations";
import { getFullPaths } from "./filePathUtils";
import { ComparisonFileNode } from "../ComparisonFileNode";

export async function showDiff(
  input: ComparisonFileNode | { localPath: string; remotePath: string },
) {
  let localPath: string;
  let remotePath: string;

  if (input instanceof ComparisonFileNode) {
    // If input is a ComparisonFileNode, extract paths using getFullPaths
    const fullPaths = await getFullPaths(input);
    localPath = fullPaths.localPath;
    remotePath = fullPaths.remotePath;
  } else {
    // If input is an object containing localPath and remotePath
    ({ localPath, remotePath } = input);
  }

  if (!localPath || !remotePath) {
    window.showErrorMessage(
      `No local or remote path found for ${input instanceof ComparisonFileNode ? input.relativePath : "provided paths"}`,
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
      `${path.basename(localPath)} : Local ↔ Remote`,
    );
  } catch (error: any) {
    window.showErrorMessage(`Error showing diff: ${error.message}`);
  }
}
