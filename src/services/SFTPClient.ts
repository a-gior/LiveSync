const SftpClient = require("ssh2-sftp-client"); // Use CommonJS require
import { BaseClient } from "./BaseClient";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { BaseNodeType } from "../utilities/BaseNode";
import { logInfoMessage, LogManager } from "../managers/LogManager";

export class SFTPClient extends BaseClient {
  private static instance: SFTPClient;
  private _client;

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
    const connectionOptions = {
      ...this.getConnectionOptions(config),
      retries: 0
    };

    await this.waitForConnection();

    if (this.isConnected) {
      return;
    }

    logInfoMessage(`Connecting using SFTP to ${config.hostname}:${config.port}`);
    this.isConnecting = true;

    return this._client
      .connect(connectionOptions)
      .then(() => {
        this.isConnected = true;
        this.isConnecting = false;
        logInfoMessage("SFTP connection is ready");
      })
      .catch((err: any) => {
        this.isConnecting = false;
        this.isConnected = false;
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
    await this._client.fastPut(localFile, remoteFile);
    LogManager.log(`Uploaded ${localFile} to ${remoteFile}`);
  }

  async downloadFile(remoteFile: string, localFile: string): Promise<void> {
    await this._client.fastGet(remoteFile, localFile);
    LogManager.log(`Downloaded ${remoteFile} to ${localFile}`);
  }

  async createDirectory(remoteDir: string) {
    await this._client.mkdir(remoteDir, true);
    LogManager.log(`Created directory ${remoteDir}`);
  }

  async deleteDirectory(remoteDir: string) {
    await this._client.rmdir(remoteDir, true);
    LogManager.log(`Deleted directory ${remoteDir}`);
  }

  async deleteFile(remoteFile: string) {
    await this._client.delete(remoteFile);
    LogManager.log(`Deleted ${remoteFile}`);
  }

  async listFiles(remoteDir: string, fileGlob?: any) {
    const ret = await this._client.list(remoteDir, fileGlob);
    LogManager.log(`Listed ${remoteDir}`);
    return ret;
  }

  async getFileStats(remotePath: string) {
    const ret = await this._client.stat(remotePath);
    LogManager.log(`Fetch stats for ${remotePath}`);
    return ret;
  }

  async moveFile(oldRemotePath: string, newRemotePath: string) {
    await this._client.rename(oldRemotePath, newRemotePath);
    LogManager.log(`Moved/Renamed file from ${oldRemotePath} to ${newRemotePath}`);
  }

  async pathExists(remotePath: string): Promise<BaseNodeType | false> {
    const result = await this._client.exists(remotePath);
    if (result === false) {
      return false;
    } else if (result === "-") {
      return BaseNodeType.file;
    } else if (result === "d") {
      return BaseNodeType.directory;
    }

    return false;
  }
}
