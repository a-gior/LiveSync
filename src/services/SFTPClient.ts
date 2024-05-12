import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { SFTPError } from "@shared/DTOs/sftpErrorDTO";
import Client = require("ssh2-sftp-client");
import * as fs from "fs";
import * as path from "path";

export class SFTPClient {
  private _client: Client;
  private _errorMsgs: SFTPError[];

  constructor() {
    this._client = new Client();
    this._errorMsgs = [];
  }

  async connect(config: ConfigurationMessage["configuration"]) {
    console.log(`Connecting to ${config.hostname}:${config.port}`);
    try {
      const connectionOptions: Client.ConnectOptions = {
        host: config.hostname,
        port: config.port,
        username: config.username,
      };

      console.log("Authmethod: ", config.authMethod);
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

      await this._client.connect(connectionOptions);
    } catch (err) {
      this._addError("Connection failed", err);
    }
  }

  async disconnect() {
    console.log(`Disconnecting.`);
    await this._client.end();
  }

  async listFiles(remoteDir: string, fileGlob?: any) {
    console.log(`Listing ${remoteDir} ...`);
    let fileObjects: Client.FileInfo[];
    const fileNames = [];

    try {
      fileObjects = await this._client.list(remoteDir, fileGlob);

      for (const file of fileObjects) {
        if (file.type === "d") {
          console.log(
            `${new Date(file.modifyTime).toISOString()} PRE ${file.name}`,
          );
        } else {
          console.log(
            `${new Date(file.modifyTime).toISOString()} ${file.size} ${file.name}`,
          );
        }

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

  getClient() {
    return this._client;
  }

  getErrors() {
    return this._errorMsgs;
  }
}
