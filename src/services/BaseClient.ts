import * as fs from "fs";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { SFTPError } from "../DTOs/sftpErrorDTO";

export abstract class BaseClient {
  protected isConnected: boolean = false;
  protected isConnecting: boolean = false;
  protected _errorMsgs: SFTPError[] = [];

  abstract connect(
    config: ConfigurationMessage["configuration"],
  ): Promise<void>;
  abstract disconnect(): Promise<void>;

  protected _addError(msg: string, err: any): void {
    this._errorMsgs.push({
      msg: msg + ": ",
      error: err,
    });
  }

  async waitForConnection(): Promise<void> {
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
  }

  protected getConnectionOptions(
    config: ConfigurationMessage["configuration"],
    timeout?: number, // Optional timeout in milliseconds
  ): any {
    const connectionOptions: any = {
      host: config.hostname,
      port: config.port,
      username: config.username,
      readyTimeout: timeout || 5000, // Handshake timeout
      timeout: timeout || 5000, // Socket-level timeout
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

    return connectionOptions;
  }

  getErrors(): SFTPError[] {
    return this._errorMsgs;
  }
}
