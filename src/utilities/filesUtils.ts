import * as path from "path";
import * as fs from "fs";
import { SFTPClient } from "../services/SFTPClient";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";

import { window, workspace, Uri, commands, TextDocument } from "vscode";
import {
  FileEntry,
  FileEntrySource,
  FileEntryStatus,
  FileEntryType,
} from "../utilities/FileEntry";
import { PairFoldersMessage } from "../DTOs/messages/PairFoldersMessage";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";

export async function listRemoteFilesRecursive(
  remoteDir: string,
  fileGlob?: any,
): Promise<FileEntry> {
  console.log(`Listing ${remoteDir} recursively...`);
  const sftpClient = new SFTPClient();
  const workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();

  try {
    // Connect to the remote server
    if (workspaceConfiguration.configuration) {
      await sftpClient.connect(workspaceConfiguration.configuration);
    }

    const client = sftpClient.getClient();
    const listDirectory = async (dir: string): Promise<FileEntry> => {
      const normalizedDir = dir.replace(/\\/g, "/");
      const dirStat = await client.stat(normalizedDir);
      const fileObjects = await client.list(normalizedDir, fileGlob);
      console.log("FileObj remote: ", dirStat);
      const directoryContents: FileEntry = new FileEntry(
        path.basename(normalizedDir),
        FileEntryType.directory,
        dirStat.size,
        new Date(dirStat.modifyTime * 1000), // modifyTime is in seconds
        FileEntrySource.remote,
        normalizedDir,
      );

      for (const file of fileObjects) {
        const filePath = path
          .join(normalizedDir, file.name)
          .replace(/\\/g, "/");
        if (file.type === "d") {
          console.log(
            `${new Date(file.modifyTime).toISOString()} PRE ${file.name}`,
          );
          // Recursively list files in subdirectory
          const subfiles = await listDirectory(filePath);
          directoryContents.addChild(subfiles);
        } else {
          console.log(
            `${new Date(file.modifyTime).toISOString()} ${file.size} ${file.name}`,
          );
          directoryContents.addChild(
            new FileEntry(
              file.name,
              FileEntryType.file,
              file.size,
              new Date(file.modifyTime),
              FileEntrySource.remote,
              filePath,
            ),
          );
        }
      }
      return directoryContents;
    };

    return await listDirectory(remoteDir);
  } catch (error) {
    console.error("Recursive remote listing failed:", error);
    return new FileEntry(
      "",
      FileEntryType.directory,
      0,
      new Date(),
      FileEntrySource.remote,
      "",
    );
  } finally {
    // Disconnect from the remote server
    await sftpClient.disconnect();
  }
}

function normalizePath(p: string): string {
  let normalizedPath = path.normalize(p);
  if (process.platform === "win32") {
    // Ensure the drive letter is in uppercase
    normalizedPath =
      normalizedPath.charAt(0).toLowerCase() + normalizedPath.slice(1);
    normalizedPath = normalizedPath.replace(/\\/g, "/");
  }
  return normalizedPath;
}

export async function listLocalFilesRecursive(
  localDir: string,
): Promise<FileEntry> {
  console.log(`Listing ${localDir} recursively...`);

  const listDirectory = async (dir: string): Promise<FileEntry> => {
    console.log("\nlistDir: ", path.basename(dir));
    const directoryContents: FileEntry = new FileEntry(
      path.basename(dir),
      FileEntryType.directory,
      fs.statSync(dir).size,
      fs.statSync(dir).mtime,
      FileEntrySource.local,
      path.normalize(dir),
    );

    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      console.log(`\nCheck path ${file.path} -- ${file.name}`);
      const filePath = path.join(file.path, file.name);
      const normalizedFilePath = path.normalize(filePath);
      if (file.isDirectory()) {
        console.log(
          `${fs.statSync(normalizedFilePath).mtime.toISOString()} PRE ${file.name}`,
        );
        // Recursively list files in subdirectory
        const subfiles = await listDirectory(normalizedFilePath);
        directoryContents.addChild(subfiles);
      } else {
        console.log(
          `${fs.statSync(normalizedFilePath).mtime.toISOString()} ${fs.statSync(normalizedFilePath).size} ${file.name}`,
        );
        directoryContents.addChild(
          new FileEntry(
            file.name,
            FileEntryType.file,
            fs.statSync(normalizedFilePath).size,
            fs.statSync(normalizedFilePath).mtime,
            FileEntrySource.local,
            normalizedFilePath,
          ),
        );
      }
    }

    return directoryContents;
  };

  try {
    return await listDirectory(localDir);
  } catch (err) {
    console.error("Recursive local listing failed", err);
    return new FileEntry(
      "",
      FileEntryType.directory,
      0,
      new Date(),
      FileEntrySource.local,
      "",
    );
  }
}

function getRemotePath(
  localPath: string,
  pairedFolders: PairFoldersMessage["paths"][],
): string | null {
  for (const folder of pairedFolders) {
    console.log(
      `File Local path : ${normalizePath(localPath)} / Folder local config path: ${normalizePath(folder.localPath)}`,
    );
    if (normalizePath(localPath).startsWith(normalizePath(folder.localPath))) {
      return path
        .join(folder.remotePath, path.relative(folder.localPath, localPath))
        .replace(/\\/g, "/");
    }
  }
  return null;
}

// NOT TESTED
function getLocalPath(
  remotePath: string,
  pairedFolders: PairFoldersMessage["paths"][],
): string | null {
  for (const folder of pairedFolders) {
    if (remotePath.startsWith(folder.remotePath)) {
      return path.join(
        folder.localPath,
        path.relative(folder.remotePath, remotePath),
      );
    }
  }
  return null;
}

async function downloadRemoteFile(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
  localTmpPath: string,
): Promise<void> {
  const sftp = new SFTPClient();
  try {
    await sftp.connect(configuration);

    // Ensure the directory for localTmpPath exists
    const dir = path.dirname(localTmpPath);
    await fs.promises.mkdir(dir, { recursive: true });

    await sftp.getClient().fastGet(remotePath, localTmpPath);
  } finally {
    sftp.disconnect();
  }
}

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

export async function handleFileSave(document: TextDocument) {
  const config = workspace.getConfiguration("LiveSync");
  const actionOnSave = config.get<string>("actionOnSave");

  if (actionOnSave === "upload" || actionOnSave === "check&upload") {
    await uploadFile(document);
  }
}

async function uploadFile(document: TextDocument) {
  const localPath = document.uri.fsPath;
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();
  const pairedFolders: PairFoldersMessage["paths"][] =
    workspaceConfig["pairedFolders"] || [];

  if (!workspaceConfig["configuration"]) {
    window.showErrorMessage("Remote server not configured");
    return;
  }

  const remotePath = getRemotePath(localPath, pairedFolders);
  if (!remotePath) {
    window.showErrorMessage(
      `No remote folder paired with local folder: ${localPath}`,
    );
    return;
  }

  const sftp = new SFTPClient();
  try {
    await sftp.connect(workspaceConfig.configuration);

    // Implement the SFTP upload logic here
    await sftp.getClient().put(localPath, remotePath);
    window.showInformationMessage(
      `File ${localPath} uploaded to ${remotePath}`,
    );
  } catch (error: any) {
    window.showErrorMessage(`Failed to upload file: ${error.message}`);
  } finally {
    sftp.disconnect();
  }
}
