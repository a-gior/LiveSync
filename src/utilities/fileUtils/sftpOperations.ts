import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { ConfigurationMessage } from "../../DTOs/messages/ConfigurationMessage";
import { generateHash } from "./hashUtils";
import { loadFromFile } from "./fileOperations";
import { REMOTE_FILES_PATH } from "../constants";
import { uploadDirectory } from "./directoryOperations";
import { FileEntrySource, FileEntryType } from "../FileEntry";
import { SSHClient } from "../../services/SSHClient";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { window } from "vscode";
import { ConnectionManager } from "../../services/ConnectionManager";
import { ConfigurationState } from "../../DTOs/states/ConfigurationState";

export async function downloadRemoteFile(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
  localTmpPath: string,
): Promise<void> {
  const sftp = SFTPClient.getInstance();
  try {
    await sftp.connect(configuration);

    const dir = path.dirname(localTmpPath);
    await fs.promises.mkdir(dir, { recursive: true });

    await sftp.getClient().fastGet(remotePath, localTmpPath);
  } finally {
    await sftp.disconnect();
  }
}

export async function uploadFile(
  configuration: ConfigurationMessage["configuration"],
  localPath: string,
  remotePath: string,
): Promise<void> {
  const sftp = SFTPClient.getInstance();
  try {
    await sftp.connect(configuration);

    // Check if remote directory exists, if not create it
    const remoteDir = path.dirname(remotePath);
    const dirExists = await sftp.getClient().exists(remoteDir);
    if (!dirExists) {
      await sftp.getClient().mkdir(remoteDir, true);
    }

    await sftp.getClient().put(localPath, remotePath);
  } finally {
    await sftp.disconnect();
  }
}

export async function compareRemoteFileHash(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
): Promise<boolean> {
  try {
    const remoteFileHash = generateHash(
      remotePath,
      FileEntrySource.remote,
      FileEntryType.file,
    );

    const storedRemoteFiles = await loadFromFile<{ [key: string]: any }>(
      REMOTE_FILES_PATH,
    );
    const storedHash = storedRemoteFiles[remotePath]?.hash;

    return remoteFileHash === storedHash;
  } catch (error) {
    console.error("Error comparing remote file hash:", error);
    return false;
  }
}

export async function getRemoteHash(
  remotePath: string,
): Promise<string | undefined> {
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();

  if (!workspaceConfig["configuration"]) {
    window.showErrorMessage("Remote server not configured");
    return;
  }

  const connectionManager = ConnectionManager.getInstance(
    workspaceConfig["configuration"],
  );
  const command = `sha256sum ${remotePath} | awk '{ print $1 }'`;
  let fileHash: string | undefined;

  try {
    await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
      const hash = await sshClient.executeCommand(command);
      fileHash = hash.trim(); // Ensure any extra whitespace is removed
    });
  } catch (err) {
    window.showErrorMessage("Error getting remote file hash");
    console.log("Error: ", err);
  }

  return fileHash;
}

export async function remotePathExists(remotePath: string) {
  const workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfiguration.configuration) {
    throw new Error("Please configure the plugin.");
  }

  try {
    const connectionManager = ConnectionManager.getInstance(
      workspaceConfiguration.configuration,
    );
    return await connectionManager.doSFTPOperation(
      async (sftpClient: SFTPClient) => {
        return await sftpClient.pathExists(remotePath);
      },
    );
  } catch (error) {
    console.error(`Error while checking if path exists: ${remotePath}`, error);
  }
}
