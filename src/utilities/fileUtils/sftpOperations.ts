import * as fs from "fs";
import * as path from "path";
import { SFTPClient } from "../../services/SFTPClient";
import { ConfigurationMessage } from "../../DTOs/messages/ConfigurationMessage";
import { generateHash } from "./hashUtils";
import { loadFromFile } from "./fileOperations";
import { REMOTE_FILES_PATH } from "../constants";

export async function downloadRemoteFile(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
  localTmpPath: string,
): Promise<void> {
  const sftp = new SFTPClient();
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
  const sftp = new SFTPClient();
  try {
    await sftp.connect(configuration);

    await sftp.getClient().put(localPath, remotePath);
  } finally {
    await sftp.disconnect();
  }
}

export async function getRemoteFileMetadata(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
): Promise<{ name: string; size: number; modifiedTime: Date }> {
  const sftp = new SFTPClient();
  try {
    await sftp.connect(configuration);
    const client = sftp.getClient();
    const stat = await client.stat(remotePath);
    return {
      name: path.basename(remotePath),
      size: stat.size,
      modifiedTime: new Date(stat.modifyTime * 1000), // convert to milliseconds
    };
  } finally {
    await sftp.disconnect();
  }
}

export async function compareRemoteFileHash(
  configuration: ConfigurationMessage["configuration"],
  remotePath: string,
): Promise<boolean> {
  try {
    const remoteFileMetadata = await getRemoteFileMetadata(
      configuration,
      remotePath,
    );
    const remoteFileHash = generateHash(
      remoteFileMetadata.name,
      remoteFileMetadata.size,
      remoteFileMetadata.modifiedTime,
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
