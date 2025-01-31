import { Client, ConnectConfig } from "ssh2";
import { BaseClient } from "./BaseClient";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { LogManager } from "../managers/LogManager";

export class SSHClient extends BaseClient {
  private static instance: SSHClient;
  private _client: Client;

  private constructor() {
    super();
    this._client = new Client();
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

    const connectionOptions: ConnectConfig = this.getConnectionOptions(config);

    return new Promise((resolve, reject) => {
      this._client
        .on("ready", () => {
          this.isConnecting = false;
          this.isConnected = true;
          console.log("SSH connection is ready");
          resolve();
        })
        .on("connect", () => {
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
          console.log("SSH connection timed out");
          reject(new Error("Connection timeout"));
        })
        .on("error", (err) => {
          this.isConnecting = false;
          this.isConnected = false;
          console.error("SSH connection error:", err);
          reject(err);
        })
        .connect(connectionOptions);
    });
  }

  async disconnect(): Promise<void> {
    console.log(`Disconnecting SSH. isConnected: ${this.isConnected}`);
    if (this.isConnected) {
      this._client.end();
      this.isConnected = false;
    }
  }

  async executeCommand(command: string, dataCallback?: (data: string) => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this._client.exec(command, (err, stream) => {
        if (err) {
          return reject(err);
        }

        let output = "";

        stream
          .on("close", (code: number, signal: string) => {
            if (code !== 0) {
              return reject(new Error(`Command exited with code ${code} and signal ${signal}`));
            }
            resolve(output);
          })
          .on("data", (data: Buffer) => {
            const dataString = data.toString();
            if (dataCallback) {
              dataCallback(dataString);
            }
            output += dataString;
          })
          .stderr.on("data", (data: Buffer) => {
            output += data.toString();
          });
      });
    });
  }

  async createDirectoriesBatch(directories: string[]) {
    if (directories.length === 0) {
      return;
    }

    // Only create the deepest directories, relying on `mkdir -p` to handle parent directories
    const mkdirCommand = `mkdir -p ${directories.map((dir) => `'${dir}'`).join(" ")}`;

    try {
      await this.executeCommand(mkdirCommand);
      LogManager.log(`SFTP Created directories: ${directories.map((dir) => `'${dir}'`).join(" ")}`);
    } catch (error) {
      LogManager.log("Error creating directories in batch");
      throw error;
    }
  }
}
