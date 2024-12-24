import { Client, ConnectConfig } from "ssh2";
import { BaseClient } from "./BaseClient";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";

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
          this._addError("Connection timeout", new Error("Connection timeout"));
          reject(new Error("Connection timeout"));
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
    console.log(`Disconnecting SSH. isConnected: ${this.isConnected}`);
    if (this.isConnected) {
      this._client.end();
      this.isConnected = false;
    }
  }

  async executeCommand(
    command: string,
    dataCallback?: (data: string) => void,
  ): Promise<string> {
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
}
