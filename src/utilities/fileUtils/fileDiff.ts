import * as path from "path";
import { window, Uri, commands } from "vscode";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";
import { ConfigurationMessage } from "../../DTOs/messages/ConfigurationMessage";
import { FileEntry } from "../../utilities/FileEntry";
import { downloadRemoteFile } from "./sftpOperations";
import { getRemotePath } from "./filePathUtils";

export async function showDiff(fileEntry: FileEntry) {
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();
  const pairedFolders: PairFoldersMessage["paths"][] =
    workspaceConfig["pairedFolders"] || [];
  if (!workspaceConfig["configuration"]) {
    window.showErrorMessage("Remote server not configured");
    return;
  }
  const configuration: ConfigurationMessage["configuration"] =
    workspaceConfig["configuration"];

  const localFilePath = fileEntry.fullPath;
  const remoteFilePath = getRemotePath(localFilePath, pairedFolders);

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
