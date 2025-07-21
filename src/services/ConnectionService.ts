import * as net from 'net';
import { ConfigurationMessage } from '@shared/DTOs/messages/ConfigurationMessage';
import { SFTPClient } from './SFTPClient';
import { SSHClient } from './SSHClient';
import { StatusBarManager } from '../managers/StatusBarManager';
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from '../managers/LogManager';

/**
 * Manages SSH and SFTP connections for a specific workspace/config.
 */
export class ConnectionService {
  private sshClient = new SSHClient();
  private sftpClient = new SFTPClient();
  private sshActive = 0;
  private sftpActive = 0;
  private sshDisconnectTimer: NodeJS.Timeout | null = null;
  private sftpDisconnectTimer: NodeJS.Timeout | null = null;
  private readonly maxRetries = 3;
  private readonly backoffBaseMs = 500;

  constructor(private readonly cfg: ConfigurationMessage['configuration']) {}

  public async withSSH<T>(
    op: (c: SSHClient) => Promise<T>,
    label?: string
  ): Promise<T> {
    this.sshActive++;
    if (label) {StatusBarManager.showMessage(label, '', '', 0, 'sync~spin', true);}
    try {
      await this.ensureReachable();
      await this.sshClient.connect(this.cfg);
      const result = await this.retry(() => op(this.sshClient));
      if (label) {StatusBarManager.showMessage(label, '', '', 3000, 'check');}
      return result;
    } catch (err) {
      if (label) {StatusBarManager.showMessage(label, '', '', 3000, 'error');}
      throw err;
    } finally {
      this.sshActive--;
      this.scheduleDisconnect('ssh');
    }
  }

  public async withSFTP<T>(
    op: (c: SFTPClient) => Promise<T>,
    label?: string
  ): Promise<T> {
    this.sftpActive++;
    if (label) {StatusBarManager.showMessage(label, '', '', 0, 'sync~spin', true);}
    try {
      await this.ensureReachable();
      await this.sftpClient.connect(this.cfg);
      const result = await this.retry(() => op(this.sftpClient));
      if (label) {StatusBarManager.showMessage(label, '', '', 3000, 'check');}
      return result;
    } catch (err) {
      if (label) {StatusBarManager.showMessage(label, '', '', 3000, 'error');}
      throw err;
    } finally {
      this.sftpActive--;
      this.scheduleDisconnect('sftp');
    }
  }

  public async dispose(): Promise<void> {
    clearTimeout(this.sshDisconnectTimer!);
    clearTimeout(this.sftpDisconnectTimer!);
    await this.sshClient.disconnect();
    await this.sftpClient.disconnect();
  }

  private async ensureReachable(): Promise<void> {
    const ok = await ConnectionService.isReachable(
      this.cfg.hostname,
      this.cfg.port
    );
    if (!ok) {
      throw new Error(`Host unreachable: ${this.cfg.hostname}:${this.cfg.port}`);
    }
  }

  private scheduleDisconnect(type: 'ssh' | 'sftp') {
    const activeCount = type === 'ssh' ? this.sshActive : this.sftpActive;
    const timerRef = type === 'ssh' ? 'sshDisconnectTimer' : 'sftpDisconnectTimer';
    const disconnectFn = type === 'ssh' ? this.sshClient.disconnect.bind(this.sshClient) : this.sftpClient.disconnect.bind(this.sftpClient);

    if (this[timerRef]) {clearTimeout(this[timerRef]!);}
    this[timerRef] = setTimeout(async () => {
      if (activeCount === 0) {
        await disconnectFn();
      }
    }, 5000);
  }

  private async retry<T>(
    fn: () => Promise<T>,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (retries > 0 && this.isRetryable(err)) {
        const backoff = this.backoffBaseMs * (this.maxRetries - retries + 1);
        logInfoMessage(`Retrying in ${backoff}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, backoff));
        return this.retry(fn, retries - 1);
      }
      logErrorMessage(err.message, LOG_FLAGS.VSCODE_ONLY);
      throw err;
    }
  }

  private isRetryable(err: any): boolean {
    return ['ECONNRESET', 'ETIMEDOUT', 'ERR_GENERIC_CLIENT'].includes(err.code) ||
      /Instance unusable/.test(err.message);
  }

  public static isReachable(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const sock = new net.Socket();
      sock.setTimeout(2000);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
      sock.once('error', () => { sock.destroy(); resolve(false); });
      sock.connect(port, host);
    });
  }
}