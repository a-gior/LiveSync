import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { SFTPError } from "@shared/DTOs/sftpErrorDTO";
import Client = require("ssh2-sftp-client");
import * as fs from "fs";
import { window } from "vscode";

export class SFTPClient {
  private static instance: SFTPClient;
  private _client: Client;
  private _errorMsgs: SFTPError[];
  private isConnected: boolean = false;
  private isConnecting: boolean = false;

  private constructor() {
    this._client = new Client();
    this._errorMsgs = [];
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

    console.log(
      `Connecting using SFTP to ${config.hostname}:${config.port} using ${config.authMethod}`,
    );
    this.isConnecting = true;
    const connectionOptions: Client.ConnectOptions = {
      host: config.hostname,
      port: config.port,
      username: config.username,
    };

    if (config.authMethod === "auth-password") {
      connectionOptions.password = config.password;
    } else if (config.authMethod === "auth-sshKey") {
      if (!config.sshKey) {
        throw new Error("SSH Key file path is not provided");
      }
      connectionOptions.privateKey = fs.readFileSync(config.sshKey);
    } else {
      throw new Error("Invalid authentication method");
    }

    return new Promise((resolve, reject) => {
      this._client
        .connect(connectionOptions)
        .then(() => {
          this.isConnected = true;
          this.isConnecting = false;
          console.log("SFTP connection is ready");
          resolve();
        })
        .catch((err) => {
          this.isConnecting = false;
          this.isConnected = false;
          console.error("SFTP connection error:", err);
          this._addError("Connection failed", err);
          reject(err);
        });
    });
  }

  async disconnect(): Promise<void> {
    console.log(`Disconnecting SFTP. isConnected ${this.isConnected}`);
    if (this.isConnected) {
      await this._client.end();
      this.isConnected = false;
    }
  }

  async waitForConnection() {
    const timeout = 5000;
    const pause = 1000;
    let currentTime = 0;
    let retries = 0;
    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

    while (this.isConnecting && currentTime <= timeout) {
      await delay(pause);
      currentTime += pause;
      console.log(
        `Waiting for connection ${currentTime}. Retries ${retries++}/${timeout / pause}`,
      );
    }

    // console.log(
    //   `Connection is connecting: ${this.isConnecting}, isConnected: ${this.isConnected}`,
    // );
  }

  async listFiles(remoteDir: string, fileGlob?: any) {
    console.log(`Listing ${remoteDir}`);
    let fileObjects: Client.FileInfo[];
    const fileNames = [];

    try {
      fileObjects = await this._client.list(remoteDir, fileGlob);

      for (const file of fileObjects) {
        fileNames.push(file.name);
      }
    } catch (err) {
      this._addError("Listing failed", err);
    }

    return fileNames;
  }

  async uploadFile(localFile: string, remoteFile: string) {
    console.log(`Uploading ${localFile} to ${remoteFile} ...`);
    try {
      await this._client.put(localFile, remoteFile);
    } catch (err) {
      this._addError("Uploading failed", err);
    }
  }

  async downloadFile(remoteFile: string, localFile: string) {
    console.log(`Downloading ${remoteFile} to ${localFile} ...`);
    try {
      await this._client.get(remoteFile, localFile);
    } catch (err) {
      this._addError("Downloading failed", err);
    }
  }

  async deleteFile(remoteFile: string) {
    console.log(`Deleting ${remoteFile}`);
    try {
      await this._client.delete(remoteFile);
    } catch (err) {
      this._addError("Deleting failed", err);
    }
  }

  async pathExists(remotePath: string) {
    return this._client.exists(remotePath);
  }

  private _addError(msg: string, err: any) {
    console.log(msg, err);
    this._errorMsgs.push({
      msg: msg + ": ",
      error: err,
    });
  }

  getErrors() {
    return this._errorMsgs;
  }

  getClient() {
    return this._client;
  }
}
