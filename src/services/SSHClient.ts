import { Client, ConnectConfig } from "ssh2";
import * as fs from "fs";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { SFTPError } from "../DTOs/sftpErrorDTO";
import { window } from "vscode";

export class SSHClient {
  private static instance: SSHClient;
  private _client: Client;
  private _errorMsgs: SFTPError[];
  private isConnected: boolean = false;
  private isConnecting: boolean = false;

  private constructor() {
    this._client = new Client();
    this._errorMsgs = [];
  }

  static getInstance(): SSHClient {
    if (!SSHClient.instance) {
      SSHClient.instance = new SSHClient();
    }
    return SSHClient.instance;
  }

  async connect(config: ConfigurationMessage["configuration"]): Promise<void> {
    await this.waitForConnection();

    if (this.isConnected) {
      return;
    }

    console.log(`Connecting using SSH to ${config.hostname}:${config.port}`);
    this.isConnecting = true;
    const connectionOptions: ConnectConfig = {
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
        .on("ready", () => {
          this.isConnecting = false;
          this.isConnected = true;
          console.log("SSH connection is ready");
          resolve();
        })
        .on("connect", () => {
          this.isConnecting = false;
          this.isConnected = true;
          console.log("SSH connection is connected");
        })
        .on("close", () => {
          this.isConnecting = false;
          this.isConnected = false;
          console.log("SSH connection is closed");
        })
        .on("timeout", () => {
          this.isConnecting = false;
          this.isConnected = false;
          console.log("SSH connection is timeout");
          // this._addError("Connection timeout", new Error("Connection timeout"));
        })
        .on("error", (err) => {
          this.isConnecting = false;
          this.isConnected = false;
          console.error("SSH connection error:", err);
          this._addError("Connection failed", err);
          reject(err);
        })
        .connect(connectionOptions);
    });
  }

  async disconnect(): Promise<void> {
    console.log(`Disconnecting SSH. isConnected ${this.isConnected}`);
    if (this.isConnected) {
      this._client.end();
      this.isConnected = false;
    }
  }

  async executeCommand(command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this._client.exec(command, (err, stream) => {
        if (err) {
          return reject(err);
        }

        let output = "";

        stream
          .on("close", (code: number, signal: string) => {
            if (code !== 0) {
              return reject(
                new Error(
                  `Command exited with code ${code} and signal ${signal}`,
                ),
              );
            }
            resolve(output);
          })
          .on("data", (data: Buffer) => {
            output += data.toString();
          })
          .stderr.on("data", (data: Buffer) => {
            output += data.toString();
          });
      });
    });
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
}
