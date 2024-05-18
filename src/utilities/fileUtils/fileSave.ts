import { workspace, window, TextDocument } from "vscode";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { PairFoldersMessage } from "../../DTOs/messages/PairFoldersMessage";
import { getRemotePath } from "./filePathUtils";
import { uploadFile, compareRemoteFileHash } from "./sftpOperations";
import { ConfigurationState } from "../../DTOs/states/ConfigurationState";

export async function handleFileSave(document: TextDocument) {
  const config = workspace.getConfiguration("LiveSync");
  const actionOnSave = config.get<string>("actionOnSave");

  if (actionOnSave === "upload" || actionOnSave === "check&upload") {
    const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();
    const pairedFolders: PairFoldersMessage["paths"][] =
      workspaceConfig["pairedFolders"] || [];

    if (!workspaceConfig["configuration"]) {
      window.showErrorMessage("Remote server not configured");
      return;
    }

    const localPath = document.uri.fsPath;
    const remotePath = getRemotePath(localPath, pairedFolders);
    if (!remotePath) {
      window.showErrorMessage(
        `No remote folder paired with local folder: ${localPath}`,
      );
      return;
    }

    if (actionOnSave === "check&upload") {
      const isSame = await compareRemoteFileHash(
        workspaceConfig.configuration,
        remotePath,
      );

      if (!isSame) {
        const userResponse = await window.showWarningMessage(
          `The remote file at ${remotePath} has been modified. Do you want to overwrite it with the local changes?`,
          { modal: true },
          "Yes",
          "No",
        );

        if (userResponse !== "Yes") {
          window.showInformationMessage("File upload canceled.");
          return;
        }
      }
    }
    await uploadFileOnSave(workspaceConfig, localPath, remotePath);
  }
}

async function uploadFileOnSave(
  workspaceConfig: ConfigurationState,
  localPath: string,
  remotePath: string,
) {
  try {
    if (!workspaceConfig.configuration) {
      window.showErrorMessage("Please configure the plugin");
      return;
    }
    await uploadFile(workspaceConfig.configuration, localPath, remotePath);
    window.showInformationMessage(
      `File ${localPath} uploaded to ${remotePath}`,
    );
  } catch (error: any) {
    window.showErrorMessage(`Failed to upload file: ${error.message}`);
  }
}
