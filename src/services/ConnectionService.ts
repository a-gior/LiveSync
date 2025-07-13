import * as net from 'net';
import { Uri } from 'vscode';
import { ConfigurationMessage } from '@shared/DTOs/messages/ConfigurationMessage';
import { SFTPClient } from './SFTPClient';
import { SSHClient } from './SSHClient';
import { debounce } from '../utilities/debounce';
import { StatusBarManager } from '../managers/StatusBarManager';
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from '../managers/LogManager';

/**
 * Manages SSH and SFTP connections for a specific workspace/config.
 */
export class ConnectionService {
  private sftpClient: SFTPClient;
  private sshClient: SSHClient;
  private sftpActive = 0;
  private sshActive = 0;
  private sftpDisconnectTimer: NodeJS.Timeout | null = null;
  private sshDisconnectTimer: NodeJS.Timeout | null = null;
  private readonly maxRetries = 3;

  constructor(
    private readonly config: ConfigurationMessage['configuration']
  ) {
    // instantiate separate clients per workspace
    this.sshClient = new SSHClient();
    this.sftpClient = new SFTPClient();
  }

  /** Ensure the SSH connection is open, then run the operation. */
  public async withSSH<T>(
    op: (client: SSHClient) => Promise<T>,
    statusLabel?: string
  ): Promise<T> {
    this.sshActive++;
    if (statusLabel) StatusBarManager.showMessage(statusLabel, '', '', 0, 'sync~spin', true);
    try {
      await this.ensureSSH();
      const result = await this.retry(() => op(this.sshClient));
      if (statusLabel) StatusBarManager.showMessage(statusLabel, '', '', 3000, 'check');
      return result;
    } catch (err: any) {
      if (statusLabel) StatusBarManager.showMessage(statusLabel, '', '', 3000, 'error');
      throw err;
    } finally {
      this.sshActive--;
      this.scheduleDisconnect('ssh');
    }
  }

  /** Ensure the SFTP connection is open, then run the operation. */
  public async withSFTP<T>(
    op: (client: SFTPClient) => Promise<T>,
    statusLabel?: string
  ): Promise<T> {
    this.sftpActive++;
    if (statusLabel) StatusBarManager.showMessage(statusLabel, '', '', 0, 'sync~spin', true);
    try {
      await this.ensureSFTP();
      const result = await this.retry(() => op(this.sftpClient));
      if (statusLabel) StatusBarManager.showMessage(statusLabel, '', '', 3000, 'check');
      return result;
    } catch (err: any) {
      if (statusLabel) StatusBarManager.showMessage(statusLabel, '', '', 3000, 'error');
      throw err;
    } finally {
      this.sftpActive--;
      this.scheduleDisconnect('sftp');
    }
  }

  /** Ping server before initial connect */
  public static async isReachable(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = new net.Socket();
      const timeout = 2000;
      socket.setTimeout(timeout);
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('timeout', () => (socket.destroy(), resolve(false)));
      socket.once('error', () => (socket.destroy(), resolve(false)));
      socket.connect(port, host);
    });
  }

  /** Close both connections immediately */
  public async dispose(): Promise<void> {
    clearTimeout(this.sshDisconnectTimer!);
    clearTimeout(this.sftpDisconnectTimer!);
    await this.disconnectSSH();
    await this.disconnectSFTP();
  }

  // ---- private helpers ----

  private async ensureSSH(): Promise<void> {
    if (!this.sshClient.connected) {
      if (!(await ConnectionService.isReachable(this.config.hostname, this.config.port))) {
        throw new Error(`SSH host unreachable: ${this.config.hostname}:${this.config.port}`);
      }
      await this.sshClient.connect(this.config);
    }
  }

  private async ensureSFTP(): Promise<void> {
    if (!this.sftpClient.connected) {
      await this.ensureSSH(); // usually SSH must be up first
      await this.sftpClient.connect(this.config);
    }
  }

  private async disconnectSSH(): Promise<void> {
    if (this.sshClient.connected) await this.sshClient.disconnect();
  }

  private async disconnectSFTP(): Promise<void> {
    if (this.sftpClient.connected) await this.sftpClient.disconnect();
  }

  private scheduleDisconnect(type: 'ssh' | 'sftp') {
    const active = type === 'ssh' ? this.sshActive : this.sftpActive;
    const timerField = type === 'ssh' ? 'sshDisconnectTimer' : 'sftpDisconnectTimer';
    const disconnectFn = type === 'ssh' ? this.disconnectSSH.bind(this) : this.disconnectSFTP.bind(this);
    if ((this as any)[timerField]) clearTimeout((this as any)[timerField]);
    (this as any)[timerField] = setTimeout(async () => {
      if (active === 0) await disconnectFn();
    }, 5000);
  }

  private async retry<T>(fn: () => Promise<T>, retries: number = this.maxRetries): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (retries > 0 && this.isRetryable(err)) {
        logInfoMessage(`Retrying due to ${err.code || err.message}...`);
        return this.retry(fn, retries - 1);
      }
      logErrorMessage(err.message, LOG_FLAGS.VSCODE_ONLY);
      throw err;
    }
  }

  private isRetryable(error: any): boolean {
    const codes = ['ECONNRESET','ETIMEDOUT','ERR_GENERIC_CLIENT'];
    return codes.includes(error.code) || /Instance unusable/.test(error.message);
  }
}
