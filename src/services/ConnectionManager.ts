import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { SFTPClient } from "./SFTPClient";
import { SSHClient } from "./SSHClient";
import { window } from "vscode";
import { StatusBarManager } from "./StatusBarManager";
import * as net from "net";
import { LOG_FLAGS, logErrorMessage } from "./LogManager";

export class ConnectionManager {
  private static instance: ConnectionManager;
  private sftpClient: SFTPClient;
  private sshClient: SSHClient;
  private sftpActiveOperations = 0;
  private sshActiveOperations = 0;
  private sftpDisconnectTimeout: NodeJS.Timeout | null = null;
  private sshDisconnectTimeout: NodeJS.Timeout | null = null;
  private currentConfig: ConfigurationMessage["configuration"];
  private maxRetries = 3;

  private constructor(config: ConfigurationMessage["configuration"]) {
    this.currentConfig = config;
    this.sshClient = SSHClient.getInstance();
    this.sftpClient = SFTPClient.getInstance();
  }

  static getInstance(
    config: ConfigurationMessage["configuration"],
  ): ConnectionManager {
    if (
      !ConnectionManager.instance ||
      JSON.stringify(config) !==
        JSON.stringify(ConnectionManager.instance.currentConfig)
    ) {
      ConnectionManager.instance = new ConnectionManager(config);
    }
    return ConnectionManager.instance;
  }

  private async connectSSH() {
    if (!this.sshClient) {
      throw new Error("SSHClient not properly initialized");
    }

    await this.sshClient.connect(this.currentConfig);
  }

  private async connectSFTP() {
    if (!this.sftpClient) {
      throw new Error("SFTPClient not properly initialized");
    }

    await this.sftpClient.connect(this.currentConfig);
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

  private async retryOperation<T>(
    operation: () => Promise<T>,
    retries: number = this.maxRetries,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const retryableErrorCodes = [
        "ECONNRESET",
        "ERR_GENERIC_CLIENT",
        "ETIMEDOUT",
      ];
      const retryableErrorMessages = ["Instance unusable"];

      if (
        retries > 0 &&
        (retryableErrorCodes.includes(error.code) ||
          retryableErrorMessages.some((msg) => error.message.includes(msg)))
      ) {
        console.warn(
          `Operation failed, Error: [${error.code}] ${error.message}. Retrying (${this.maxRetries - retries + 1}/${this.maxRetries})...`,
        );
        return await this.retryOperation(operation, retries - 1);
      }
      console.error(
        `Operation failed, Error: [${error.code}] ${error.message}.`,
      );
      throw error;
    }
  }

  private async reconnect() {
    console.warn("Reconnecting SSH and SFTP clients...");
    await this.sshClient.disconnect();
    await this.sftpClient.disconnect();
    await this.connectSSH();
    await this.connectSFTP();
  }

  async doSSHOperation<T>(
    operation: (sshClient: SSHClient) => Promise<T>,
    operationName?: string,
  ): Promise<T> {
    this.sshActiveOperations++;
    const displayOperationName = operationName ? ` ${operationName}` : "";
    StatusBarManager.showMessage(
      `SSH${displayOperationName}`,
      "",
      "",
      0,
      "sync~spin",
      true,
    );

    try {
      // Check if server is reachable in a quicker way
      if (!(await this.isServerPingable())) {
        logErrorMessage(
          `Server ${this.currentConfig.hostname}:${this.currentConfig.port} is not reachable.`,
          LOG_FLAGS.ALL,
        );
        throw new Error(
          `Server ${this.currentConfig.hostname}:${this.currentConfig.port} is not reachable.`,
        );
      }

      await this.retryOperation(async () => await this.connectSSH(), 1);
      const result = await this.retryOperation(
        async () => await operation(this.sshClient),
      );
      StatusBarManager.showMessage(
        "SSH operation successful",
        "",
        "",
        3000,
        "check",
      );
      return result;
    } catch (err: any) {
      if (err.message.includes("Timed out")) {
        window.showErrorMessage(
          `Connection to ${this.currentConfig.hostname}:${this.currentConfig.port} timed out.`,
        );
      } else {
        window.showErrorMessage(
          `Couldn't do operation on ${this.currentConfig.hostname}:${this.currentConfig.port}`,
        );
      }
      console.error("Error doSSHOperation: ", err);
      StatusBarManager.showMessage(
        "SSH operation failed",
        "",
        "",
        3000,
        "error",
      );
      throw err;
    } finally {
      this.sshActiveOperations--;
      if (this.sshActiveOperations === 0) {
        this.scheduleSSHDisconnect();
      }
      // StatusBarManager.hideMessage();
    }
  }

  async doSFTPOperation<T>(
    operation: (sftpClient: SFTPClient) => Promise<T>,
    operationName?: string,
  ): Promise<T> {
    this.sftpActiveOperations++;
    const displayOperationName = operationName ? ` ${operationName}` : "";
    StatusBarManager.showMessage(
      `SFTP${displayOperationName}`,
      "",
      "",
      0,
      "sync~spin",
      true,
    );

    try {
      // Check if server is reachable in a quicker way
      if (!(await this.isServerPingable())) {
        logErrorMessage(
          `Server ${this.currentConfig.hostname}:${this.currentConfig.port} is not reachable.`,
          LOG_FLAGS.ALL,
        );
        throw new Error(
          `Server ${this.currentConfig.hostname}:${this.currentConfig.port} is not reachable.`,
        );
      }

      await this.retryOperation(async () => await this.connectSFTP(), 1);
      const result = await this.retryOperation(
        async () => await operation(this.sftpClient),
      );
      StatusBarManager.showMessage(
        "SFTP operation successful",
        "",
        "",
        3000,
        "check",
      );
      return result;
    } catch (err: any) {
      StatusBarManager.showMessage(
        "SFTP operation failed",
        "",
        "",
        3000,
        "error",
      );
      throw err;
    } finally {
      this.sftpActiveOperations--;
      if (this.sftpActiveOperations === 0) {
        this.scheduleSFTPDisconnect();
      }
    }
  }

  async isServerPingable(): Promise<boolean> {
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

      socket.connect(this.currentConfig.port, this.currentConfig.hostname);
    });
  }

  getSFTPClient(): SFTPClient {
    return this.sftpClient;
  }

  getSSHClient(): SSHClient {
    return this.sshClient;
  }
}
