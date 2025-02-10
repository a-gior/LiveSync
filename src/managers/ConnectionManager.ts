import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { SFTPClient } from "../services/SFTPClient";
import { SSHClient } from "../services/SSHClient";
import { StatusBarManager } from "./StatusBarManager";
import * as net from "net";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";

export class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  private configuration: ConfigurationMessage["configuration"];
  private sftpClient: SFTPClient;
  private sshClient: SSHClient;
  private sftpActiveOperations = 0;
  private sshActiveOperations = 0;
  private sftpDisconnectTimeout: NodeJS.Timeout | null = null;
  private sshDisconnectTimeout: NodeJS.Timeout | null = null;
  private maxRetries = 3;

  private constructor(config: ConfigurationMessage["configuration"]) {
    this.configuration = config;
    this.sshClient = SSHClient.getInstance();
    this.sftpClient = SFTPClient.getInstance();
  }

  static async getInstance(config?: ConfigurationMessage["configuration"]): Promise<ConnectionManager> {
    // Ensure there is a valid instance or config provided
    if (!ConnectionManager.instance && !config) {
      throw new Error("ConnectionManager instance not initialized, and no configuration provided.");
    }

    // If no config is provided, reuse the existing instance
    if (!config) {
      return ConnectionManager.instance!;
    }

    // Determine if we need to create a new instance
    const isNewConfig = !ConnectionManager.instance || JSON.stringify(config) !== JSON.stringify(ConnectionManager.instance.configuration);

    if (isNewConfig) {
      // Create a new instance
      const newInstance = new ConnectionManager(config);

      // Check server reachability before assigning the new instance
      const isReachable = await this.isServerPingable(config.hostname, config.port);
      if (!isReachable) {
        throw new Error(`Server ${config.hostname}:${config.port} is not reachable.`);
      }

      // Assign the validated instance
      ConnectionManager.instance = newInstance;
    }

    // Always return a valid instance
    return ConnectionManager.instance!;
  }

  private async connectSSH() {
    if (!this.sshClient) {
      throw new Error("SSHClient not properly initialized");
    }

    await this.sshClient.connect(this.configuration);
  }

  private async connectSFTP() {
    if (!this.sftpClient) {
      throw new Error("SFTPClient not properly initialized");
    }

    await this.sftpClient.connect(this.configuration);
  }

  private async disconnectSSH() {
    if (this.sshClient) {
      await this.sshClient.disconnect();
    }
  }

  private async disconnectSFTP() {
    if (this.sftpClient) {
      await this.sftpClient.disconnect();
    }
  }

  private scheduleSSHDisconnect() {
    if (this.sshDisconnectTimeout) {
      clearTimeout(this.sshDisconnectTimeout);
    }
    this.sshDisconnectTimeout = setTimeout(async () => {
      if (this.sshActiveOperations === 0) {
        await this.disconnectSSH();
      }
    }, 5000); // 5 seconds timeout
  }

  private scheduleSFTPDisconnect() {
    if (this.sftpDisconnectTimeout) {
      clearTimeout(this.sftpDisconnectTimeout);
    }
    this.sftpDisconnectTimeout = setTimeout(async () => {
      if (this.sftpActiveOperations === 0) {
        await this.disconnectSFTP();
      }
    }, 5000); // 5 seconds timeout
  }

  private async retryOperation<T>(operation: () => Promise<T>, retries: number = this.maxRetries): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const retryableErrorCodes = ["ECONNRESET", "ERR_GENERIC_CLIENT", "ETIMEDOUT"];
      const retryableErrorMessages = ["Instance unusable"];

      if (retries > 0 && (retryableErrorCodes.includes(error.code) || retryableErrorMessages.some((msg) => error.message.includes(msg)))) {
        logInfoMessage(
          `Operation failed, Error: [${error.code}] ${error.message}. Retrying (${this.maxRetries - retries + 1}/${this.maxRetries})...`
        );
        return await this.retryOperation(operation, retries - 1);
      }

      // Modify error message for ERR_BAD_PATH
      let errorMessage = error.message;
      if (error.code === "ERR_BAD_PATH" && errorMessage.includes("No such file")) {
        errorMessage = errorMessage.substring(errorMessage.indexOf("No such file"));
      }

      logErrorMessage(`[${error.code}] ${errorMessage}`, LOG_FLAGS.VSCODE_ONLY);
      throw error;
    }
  }

  async doSSHOperation<T>(operation: (sshClient: SSHClient) => Promise<T>, operationName?: string): Promise<T> {
    this.sshActiveOperations++;
    const displayOperationName = operationName ? ` ${operationName}` : "";
    StatusBarManager.showMessage(`SSH${displayOperationName}`, "", "", 0, "sync~spin", true);

    try {
      await this.retryOperation(async () => await this.connectSSH(), 0);
      const result = await this.retryOperation(async () => await operation(this.sshClient));
      StatusBarManager.showMessage("SSH operation successful", "", "", 3000, "check");
      return result;
    } catch (err: any) {
      StatusBarManager.showMessage("SSH operation failed", "", "", 3000, "error");
      throw err;
    } finally {
      this.sshActiveOperations--;
      if (this.sshActiveOperations === 0) {
        this.scheduleSSHDisconnect();
      }
      // StatusBarManager.hideMessage();
    }
  }

  async doSFTPOperation<T>(operation: (sftpClient: SFTPClient) => Promise<T>, operationName?: string): Promise<T> {
    this.sftpActiveOperations++;
    const displayOperationName = operationName ? ` ${operationName}` : "";
    StatusBarManager.showMessage(`SFTP${displayOperationName}`, "", "", 0, "sync~spin", true);

    try {
      await this.retryOperation(async () => await this.connectSFTP(), 1);
      const result = await this.retryOperation(async () => await operation(this.sftpClient));
      StatusBarManager.showMessage("SFTP operation successful", "", "", 3000, "check");
      return result;
    } catch (err: any) {
      StatusBarManager.showMessage("SFTP operation failed", "", "", 3000, "error");
      throw err;
    } finally {
      this.sftpActiveOperations--;
      if (this.sftpActiveOperations === 0) {
        this.scheduleSFTPDisconnect();
      }
    }
  }

  static async isServerPingable(hostname: string, port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      const timeout = 2000; // 2 seconds timeout

      socket.setTimeout(timeout);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, hostname);
    });
  }

  getSFTPClient(): SFTPClient {
    return this.sftpClient;
  }

  getSSHClient(): SSHClient {
    return this.sshClient;
  }
}
