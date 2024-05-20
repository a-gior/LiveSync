import { workspace, window, TextDocument } from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { ConfigurationMessage } from "../../DTOs/messages/ConfigurationMessage";
import {
  FileEntry,
  FileEntryType,
  FileEntrySource,
} from "../../utilities/FileEntry";
import { getLocalPath, getRemotePath } from "./filePathUtils";
import { listRemoteFilesRecursive } from "./fileListing";

export async function uploadDirectory(fileEntry: FileEntry): Promise<void> {
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfig.configuration || !workspaceConfig.pairedFolders) {
    window.showErrorMessage("Remote server or paired folders not configured");
    return;
  }

  const sftp = new SFTPClient();
  try {
    await sftp.connect(workspaceConfig.configuration);

    const remoteDir = getRemotePath(
      fileEntry.fullPath,
      workspaceConfig.pairedFolders,
    );
    console.log(`Uploading directory ${remoteDir}`);
    if (remoteDir === null) {
      window.showErrorMessage(`No remote path found for ${fileEntry.fullPath}`);
      return;
    }
    await sftp.getClient().mkdir(remoteDir, true);

    for (const child of fileEntry.listChildren()) {
      if (child.isDirectory()) {
        await uploadDirectory(child);
      } else {
        await sftp
          .getClient()
          .put(child.fullPath, path.join(remoteDir, child.name));
      }
    }
  } finally {
    await sftp.disconnect();
  }
}

export async function downloadDirectory(fileEntry: FileEntry): Promise<void> {
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfig.configuration || !workspaceConfig.pairedFolders) {
    window.showErrorMessage("Remote server or pairedFodlers not configured");
    return;
  }

  const sftp = new SFTPClient();
  try {
    await sftp.connect(workspaceConfig.configuration);

    const remoteDir = fileEntry.fullPath;
    const localDir = getLocalPath(remoteDir, workspaceConfig.pairedFolders);
    console.log(`Downloading directory ${remoteDir} to ${localDir}`);
    if (localDir === null) {
      window.showErrorMessage(`No local path found for ${remoteDir}`);
      return;
    }
    await fs.promises.mkdir(localDir, { recursive: true });

    const remoteFilesEntry = await listRemoteFilesRecursive(remoteDir);
    for (const [, child] of remoteFilesEntry.children) {
      if (child.type === FileEntryType.directory) {
        await downloadDirectory(child);
      } else {
        await sftp
          .getClient()
          .fastGet(child.fullPath, path.join(localDir, child.name));
      }
    }
  } finally {
    await sftp.disconnect();
  }
}

export async function deleteRemoteDirectory(
  fileEntry: FileEntry,
): Promise<void> {
  const workspaceConfig = ConfigurationPanel.getWorkspaceConfiguration();
  if (!workspaceConfig.configuration) {
    window.showErrorMessage("Remote server not configured");
    return;
  }

  const sftp = new SFTPClient();
  try {
    await sftp.connect(workspaceConfig.configuration);

    const remoteDir = fileEntry.fullPath.replace(/\\/g, "/");
    const children = await sftp.getClient().list(remoteDir);
    for (const child of children) {
      const childPath = path.join(remoteDir, child.name);
      if (child.type === "d") {
        const subDirEntry = new FileEntry(
          child.name,
          FileEntryType.directory,
          0,
          new Date(child.modifyTime * 1000),
          FileEntrySource.remote,
          childPath,
        );
        await deleteRemoteDirectory(subDirEntry);
      } else {
        await sftp.getClient().delete(childPath.replace(/\\/g, "/"));
      }
    }
    await sftp.getClient().rmdir(remoteDir);
  } finally {
    await sftp.disconnect();
  }
}
