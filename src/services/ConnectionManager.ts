import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { SFTPClient } from "./SFTPClient";
import { SSHClient } from "./SSHClient";
import { window } from "vscode";
import { StatusBarManager } from "./StatusBarManager";

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
    this.sshClient = SSHClient.getInstance();
    this.sftpClient = SFTPClient.getInstance();
    this.currentConfig = config;
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
      if (
        retries > 0 &&
        (error.code === "ECONNRESET" ||
          error.message.includes("Instance unusable") ||
          error.message.includes("timeout"))
      ) {
        console.warn(
          `Operation failed with ${error.message}. Retrying (${this.maxRetries - retries + 1}/${this.maxRetries})...`,
        );
        await this.reconnect();
        return await this.retryOperation(operation, retries - 1);
      }
      console.error(`Operation failed with ${error.message}.`);
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
      await this.retryOperation(async () => await this.connectSSH());
      const result = await operation(this.sshClient);
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
      await this.retryOperation(async () => await this.connectSFTP());
      const result = await operation(this.sftpClient);
      StatusBarManager.showMessage(
        "SFTP operation successful",
        "",
        "",
        3000,
        "check",
      );
      return result;
    } catch (err: any) {
      console.error("Error doSFTPOperation: ", err);
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

  getSFTPClient(): SFTPClient {
    return this.sftpClient;
  }

  getSSHClient(): SSHClient {
    return this.sshClient;
  }
}
