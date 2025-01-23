import SftpClient from "ssh2-sftp-client";
import { BaseClient } from "./BaseClient";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { BaseNodeType } from "../utilities/BaseNode";
import { LogManager } from "../managers/LogManager";

export class SFTPClient extends BaseClient {
  private static instance: SFTPClient;
  private _client: SftpClient;

  private constructor() {
    super();
    this._client = new SftpClient();
  }

  static getInstance(): SFTPClient {
    if (!SFTPClient.instance) {
      SFTPClient.instance = new SFTPClient();
    }
    return SFTPClient.instance;
  }

  async connect(config: ConfigurationMessage["configuration"]): Promise<void> {
    await this.waitForConnection();

    if (this.isConnected) {
      return;
    }

    console.log(`Connecting using SFTP to ${config.hostname}:${config.port}`);
    this.isConnecting = true;

    const connectionOptions: SftpClient.ConnectOptions = {
      ...this.getConnectionOptions(config),
      retries: 0,
    };

    return this._client
      .connect(connectionOptions)
      .then(() => {
        this.isConnected = true;
        this.isConnecting = false;
        console.log("SFTP connection is ready");
      })
      .catch((err) => {
        this.isConnecting = false;
        this.isConnected = false;
        this._addError("Connection failed", err);
        throw err;
      });
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this._client.end();
      this.isConnected = false;
    }
  }

  async uploadFile(localFile: string, remoteFile: string): Promise<void> {
    try {
      await this._client.fastPut(localFile, remoteFile);
      LogManager.log(`Uploaded ${localFile} to ${remoteFile}`);
    } catch (err) {
      this._addError("Uploading failed", err);
      throw err;
    }
  }

  async downloadFile(remoteFile: string, localFile: string): Promise<void> {
    try {
      await this._client.fastGet(remoteFile, localFile);
      LogManager.log(`Downloaded ${remoteFile} to ${localFile}`);
    } catch (err) {
      this._addError("Downloading failed", err);
      throw err;
    }
  }

  async createDirectory(remoteDir: string) {
    try {
      await this._client.mkdir(remoteDir, true);
      LogManager.log(`Created directory ${remoteDir}`);
    } catch (err) {
      this._addError("Creating directory failed", err);
      throw err;
    }
  }

  async deleteDirectory(remoteDir: string) {
    try {
      await this._client.rmdir(remoteDir, true);
      LogManager.log(`Deleted directory ${remoteDir}`);
    } catch (err) {
      this._addError("Deleting directory failed", err);
      throw err;
    }
  }

  async deleteFile(remoteFile: string) {
    try {
      await this._client.delete(remoteFile);
      LogManager.log(`Deleted ${remoteFile}`);
    } catch (err) {
      this._addError("Deleting failed", err);
      throw err;
    }
  }

  async listFiles(remoteDir: string, fileGlob?: any) {
    try {
      const ret = await this._client.list(remoteDir, fileGlob);
      LogManager.log(`Listed ${remoteDir}`);
      return ret;
    } catch (err) {
      this._addError("Listing failed", err);
      throw err;
    }
  }

  async getFileStats(remotePath: string) {
    try {
      const ret = await this._client.stat(remotePath);
      LogManager.log(`Fetch stats for ${remotePath}`);
      return ret;
    } catch (err) {
      this._addError("Getting stats failed", err);
      throw err;
    }
  }

  async moveFile(oldRemotePath: string, newRemotePath: string) {
    try {
      await this._client.rename(oldRemotePath, newRemotePath);
      LogManager.log(
        `Moved/Renamed file from ${oldRemotePath} to ${newRemotePath}`,
      );
    } catch (err) {
      this._addError("Moving/Renaming file failed", err);
      throw err;
    }
  }

  async pathExists(remotePath: string): Promise<BaseNodeType | false> {
    try {
      const result = await this._client.exists(remotePath);
      if (result === false) {
        return false;
      } else if (result === "-") {
        return BaseNodeType.file;
      } else if (result === "d") {
        return BaseNodeType.directory;
      }
    } catch (err) {
      this._addError(`Check if ${remotePath} exists failed`, err);
      throw err;
    }

    return false;
  }
}
