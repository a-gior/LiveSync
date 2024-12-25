import SftpClient from "ssh2-sftp-client";
import { BaseClient } from "./BaseClient";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { BaseNodeType } from "../utilities/BaseNode";

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
    console.log(`Disconnecting SFTP. isConnected: ${this.isConnected}`);
    if (this.isConnected) {
      await this._client.end();
      this.isConnected = false;
    }
  }

  async uploadFile(localFile: string, remoteFile: string): Promise<void> {
    console.log(`Uploading ${localFile} to ${remoteFile}`);
    try {
      await this._client.fastPut(localFile, remoteFile);
    } catch (err) {
      this._addError("Uploading failed", err);
      throw err;
    }
  }

  async downloadFile(remoteFile: string, localFile: string): Promise<void> {
    console.log(`Downloading ${remoteFile} to ${localFile}`);
    try {
      await this._client.fastGet(remoteFile, localFile);
    } catch (err) {
      this._addError("Downloading failed", err);
      throw err;
    }
  }

  async createDirectory(remoteDir: string) {
    console.log(`Creating directory ${remoteDir}`);
    try {
      await this._client.mkdir(remoteDir, true);
    } catch (err) {
      this._addError("Creating directory failed", err);
      throw err;
    }
  }

  async deleteDirectory(remoteDir: string) {
    console.log(`Deleting directory ${remoteDir}`);
    try {
      await this._client.rmdir(remoteDir, true);
    } catch (err) {
      this._addError("Deleting directory failed", err);
      throw err;
    }
  }

  async deleteFile(remoteFile: string) {
    console.log(`Deleting ${remoteFile}`);
    try {
      await this._client.delete(remoteFile);
    } catch (err) {
      this._addError("Deleting failed", err);
      throw err;
    }
  }

  async listFiles(remoteDir: string, fileGlob?: any) {
    console.log(`Listing ${remoteDir}`);

    try {
      return await this._client.list(remoteDir, fileGlob);
    } catch (err) {
      this._addError("Listing failed", err);
      throw err;
    }
  }

  async getFileStats(remotePath: string) {
    console.log(`Getting stats for ${remotePath}`);

    try {
      return await this._client.stat(remotePath);
    } catch (err) {
      this._addError("Getting stats failed", err);
      throw err;
    }
  }

  async moveFile(oldRemotePath: string, newRemotePath: string) {
    console.log(
      `Moving/Renaming file from ${oldRemotePath} to ${newRemotePath}`,
    );

    try {
      await this._client.rename(oldRemotePath, newRemotePath);
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
