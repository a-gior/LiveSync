import { Client, ConnectConfig } from "ssh2";
import { BaseClient } from "./BaseClient";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { LOG_FLAGS, logErrorMessage, logInfoMessage, LogManager } from "../managers/LogManager";

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
    const connectionOptions: ConnectConfig = this.getConnectionOptions(config);

    await this.waitForConnection();

    if (this.isConnected) {
      return;
    }

    logInfoMessage(`Connecting using SSH to ${config.hostname}:${config.port}`);
    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      this._client
        .on("ready", () => {
          this.isConnecting = false;
          this.isConnected = true;
          logInfoMessage("SSH connection is ready");
          resolve();
        })
        .on("connect", () => {
          logInfoMessage("SSH connection is connected");
        })
        .on("close", () => {
          this.isConnecting = false;
          this.isConnected = false;
          logInfoMessage("SSH connection is closed");
        })
        .on("timeout", () => {
          this.isConnecting = false;
          this.isConnected = false;
          logInfoMessage("SSH connection timed out");
          reject(new Error("Connection timeout"));
        })
        .on("error", (err) => {
          this.isConnecting = false;
          this.isConnected = false;
          logErrorMessage("SSH connection error:", LOG_FLAGS.CONSOLE_ONLY, err);
          reject(err);
        })
        .connect(connectionOptions);
    });
  }

  async disconnect(): Promise<void> {
    logInfoMessage(`Disconnecting SSH. isConnected: ${this.isConnected}`);
    if (this.isConnected) {
      this._client.end();
      this.isConnected = false;
    }
  }

  async executeCommand(command: string, dataCallback?: (data: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      this._client.exec(command, (err, stream) => {
        if (err) {return reject(err);}
        let output = "";
        let lineBuf = "";

        const onData = (data: string) => {
          lineBuf += data;
          const parts = lineBuf.split("\n");
          lineBuf = parts.pop()!;         // last piece is partial
          for (const line of parts) {
            if (dataCallback) {dataCallback(line + "\n");}
          }
        };
        
        stream
          .on("close", (code: number, signal: string) => {
            // 1) Flush any leftover
            if (lineBuf && dataCallback) {
              dataCallback(lineBuf);
            }

            // 2) Treat code=0 or code=1 as “OK” (1 == permission-denied)
            if (code !== 0 && code !== 1) {
              return reject(new Error(`Command exited with code ${code} and signal ${signal}`));
            }

            // 3) If it *was* a 1, emit a warning so we know something was skipped
            if (code === 1) {
              logErrorMessage(
                `Command finished with exit code 1 (some files or dirs may have been skipped due to permissions)`,
                LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
              );
            }

            // 4) Resolve normally
            resolve(output);
          })
          .on("data",   (buf: Buffer) => { const s = buf.toString(); output += s; onData(s);           })
          .stderr.on("data", (buf: Buffer) => { const s = buf.toString(); output += s; onData(s); });
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
