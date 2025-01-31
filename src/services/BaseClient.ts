import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import * as ssh2 from "ssh2";
import { normalizePath } from "../utilities/fileUtils/filePathUtils";
import { logInfoMessage } from "../managers/LogManager";

export abstract class BaseClient {
  protected isConnected: boolean = false;
  protected isConnecting: boolean = false;

  abstract connect(config: ConfigurationMessage["configuration"]): Promise<void>;
  abstract disconnect(): Promise<void>;

  async waitForConnection(): Promise<void> {
    const timeout = 5000;
    const pause = 1000;
    let currentTime = 0;
    let retries = 0;
    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

    while (this.isConnecting && currentTime <= timeout) {
      await delay(pause);
      currentTime += pause;
      logInfoMessage(`Waiting for connection ${currentTime}. Retries ${retries++}/${timeout / pause}`);
    }
  }

  protected getConnectionOptions(
    config: ConfigurationMessage["configuration"],
    timeout?: number // Optional timeout in milliseconds
  ): any {
    const connectionOptions: ssh2.ConnectConfig = {
      host: config.hostname,
      port: config.port,
      username: config.username,
      readyTimeout: timeout || 5000, // Handshake timeout
      timeout: timeout || 5000 // Socket-level timeout
    };

    if (config.authMethod === "auth-password") {
      connectionOptions.password = config.password;
    } else if (config.authMethod === "auth-sshKey") {
      if (!config.privateKeyPath) {
        throw new Error("Private Key path is not provided");
      }

      let privateKeyPath = config.privateKeyPath;

      // Handle '~' (home directory) expansion on both Windows & Linux/macOS
      if (privateKeyPath.startsWith("~")) {
        privateKeyPath = normalizePath(path.join(os.homedir(), privateKeyPath.slice(1)));
      }

      // Convert Windows-style backslashes to forward slashes for SSH compatibility
      if (process.platform === "win32") {
        privateKeyPath = privateKeyPath.replace(/\\/g, "/");
      }

      // Ensure the private key file exists
      if (!fs.existsSync(privateKeyPath)) {
        throw new Error(`Private key file not found at ${privateKeyPath}`);
      }

      // Read the private key content
      const privateKeyContent = fs.readFileSync(privateKeyPath, "utf8");

      connectionOptions.privateKey = privateKeyContent;
      connectionOptions.passphrase = config.passphrase || "";
    } else {
      throw new Error("Invalid authentication method");
    }

    return connectionOptions;
  }
}
