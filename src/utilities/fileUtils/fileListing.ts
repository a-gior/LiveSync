import * as fs from "fs";
import * as path from "path";
import {
  FileEntry,
  FileEntrySource,
  FileEntryType,
} from "../../utilities/FileEntry";
import { SFTPClient } from "../../services/SFTPClient";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";

export async function listRemoteFilesRecursive(
  remoteDir: string,
  fileGlob?: any,
): Promise<FileEntry> {
  console.log(`Listing ${remoteDir} recursively...`);
  const sftpClient = new SFTPClient();
  const workspaceConfiguration: ConfigurationState =
    ConfigurationPanel.getWorkspaceConfiguration();

  try {
    if (workspaceConfiguration.configuration) {
      await sftpClient.connect(workspaceConfiguration.configuration);
    }

    const client = sftpClient.getClient();
    const listDirectory = async (dir: string): Promise<FileEntry> => {
      const normalizedDir = dir.replace(/\\/g, "/");
      const dirStat = await client.stat(normalizedDir);
      const fileObjects = await client.list(normalizedDir, fileGlob);
      const directoryContents: FileEntry = new FileEntry(
        path.basename(normalizedDir),
        FileEntryType.directory,
        dirStat.size,
        new Date(dirStat.modifyTime * 1000),
        FileEntrySource.remote,
        normalizedDir,
      );

      for (const file of fileObjects) {
        const filePath = path
          .join(normalizedDir, file.name)
          .replace(/\\/g, "/");
        if (file.type === "d") {
          const subfiles = await listDirectory(filePath);
          directoryContents.addChild(subfiles);
        } else {
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
    await sftpClient.disconnect();
  }
}

export async function listLocalFilesRecursive(
  localDir: string,
): Promise<FileEntry> {
  console.log(`Listing ${localDir} recursively...`);

  const listDirectory = async (dir: string): Promise<FileEntry> => {
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
      const filePath = path.join(dir, file.name);
      const normalizedFilePath = path.normalize(filePath);
      if (file.isDirectory()) {
        const subfiles = await listDirectory(normalizedFilePath);
        directoryContents.addChild(subfiles);
      } else {
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
