import { ConfigurationMessage } from '../ui/DTOs/messages/configurationDTO';
import { SFTPError } from '../ui/DTOs/sftpErrorDTO';
import Client = require("ssh2-sftp-client");
import * as fs from "fs";


export class SFTPClient {
    private _client: Client;
    private _errorMsgs: SFTPError[] | undefined;

    constructor() {
      this._client = new Client();
      this._errorMsgs = undefined;
    }
  
    async connect(config: ConfigurationMessage['configuration']) {
      console.log(`Connecting to ${config.hostname}:${config.port}`);
      try {
        await this._client.connect(config);
      } catch (err) {
        this._addError('Failed to connect', err);
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
          if (file.type === 'd') {
            console.log(`${new Date(file.modifyTime).toISOString()} PRE ${file.name}`);
          } else {
            console.log(`${new Date(file.modifyTime).toISOString()} ${file.size} ${file.name}`);
          }
      
          fileNames.push(file.name);
        }
      } catch (err) {
        this._addError('Listing failed', err);
      }

      return fileNames;
    }

    async uploadFile(localFile: string, remoteFile: string) {
      console.log(`Uploading ${localFile} to ${remoteFile} ...`);
      try {
        await this._client.put(localFile, remoteFile);
      } catch (err) {
        this._addError('Uploading failed', err);
      }
    }

    async downloadFile(remoteFile: string, localFile: string) {
      console.log(`Downloading ${remoteFile} to ${localFile} ...`);
      try {
        await this._client.get(remoteFile, localFile);
      } catch (err) {
        this._addError('Downloading failed', err);
      }
    }

    async deleteFile(remoteFile: string) {
      console.log(`Deleting ${remoteFile}`);
      try {
        await this._client.delete(remoteFile);
      } catch (err) {
        this._addError('Deleting failed', err);
      }
    }

    private _addError(msg: string, err: any) {
      console.log(msg, err);
      this._errorMsgs?.push({
        msg: msg+": ",
        error: err
      });
    }

    getErrors() {
      return this._errorMsgs;
    }
  }