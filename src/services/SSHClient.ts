// src/services/SSHClient.ts
import { Client, ConnectConfig } from 'ssh2';
import { BaseClient } from './BaseClient';
import { ConfigurationMessage } from '@shared/DTOs/messages/ConfigurationMessage';
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from '../managers/LogManager';

export class SSHClient extends BaseClient {
  private readonly client = new Client();

  constructor() {
    super();
    // reset flags in case BaseClient left them set
    this.isConnecting = false;
    this.isConnected  = false;
  }

  /**
   * Opens an SSH connection using the provided settings.
   */
  public async connect(config: ConfigurationMessage['configuration']): Promise<void> {
    if (this.isConnected || this.isConnecting) {
      return;
    }
    const options: ConnectConfig = this.getConnectionOptions(config);

    logInfoMessage(`SSH: connecting to ${config.hostname}:${config.port}`);
    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      this.client
        .on('ready', () => {
          this.isConnecting = false;
          this.isConnected  = true;
          logInfoMessage('SSH: connection ready');
          resolve();
        })
        .on('error', (err) => {
          this.isConnecting = false;
          this.isConnected  = false;
          logErrorMessage(
            `SSH: connection error: ${err.message}`,
            LOG_FLAGS.CONSOLE_ONLY,
            err
          );
          reject(err);
        })
        .on('close', () => {
          this.isConnecting = false;
          this.isConnected  = false;
          logInfoMessage('SSH: connection closed');
        })
        .on('timeout', () => {
          this.isConnecting = false;
          this.isConnected  = false;
          logErrorMessage('SSH: connection timed out', LOG_FLAGS.CONSOLE_ONLY);
          reject(new Error('SSH connection timed out'));
        })
        .connect(options);
    });
  }

  /**
   * Closes the SSH connection, if open.
   */
  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      logInfoMessage('SSH: disconnecting');
      this.client.end();
      this.isConnected = false;
    }
  }

  /**
   * Executes a shell command over SSH, collecting stdout/stderr.
   */
  public async executeCommand(
    command: string,
    dataCallback?: (chunk: string) => void
  ): Promise<string> {
    if (!this.isConnected) {
      throw new Error('SSHClient: not connected');
    }

    return new Promise((resolve, reject) => {
      let output = '';
      let buffer = '';

      const onData = (chunk: string) => {
        buffer += chunk;
        const parts = buffer.split('\n');
        buffer = parts.pop()!;
        for (const line of parts) {
          dataCallback?.(line + '\n');
        }
      };

      this.client.exec(command, (err, stream) => {
        if (err) {
          return reject(err);
        }
        stream
          .on('data',   (b: Buffer) => { const s = b.toString(); output += s; onData(s); })
          .stderr.on('data', (b: Buffer) => { const s = b.toString(); output += s; onData(s); })
          .on('close', (code: number, signal: string) => {
            if (buffer && dataCallback) {
              dataCallback(buffer);
            }
            if (code !== 0 && code !== 1) {
              return reject(
                new Error(`SSH: command exited with code ${code}, signal ${signal}`)
              );
            }
            if (code === 1) {
              logErrorMessage(
                'SSH: command returned exit code 1 (permissions issues?)',
                LOG_FLAGS.CONSOLE_ONLY
              );
            }
            resolve(output);
          });
      });
    });
  }

  /**
   * Creates all directories in one batch via `mkdir -p`.
   */
  public async createDirectoriesBatch(dirs: string[]): Promise<void> {
    if (dirs.length === 0) return;
    const cmd = `mkdir -p ${dirs.map(d => `'${d}'`).join(' ')}`;
    await this.executeCommand(cmd);
  }

  /**
   * Moves/renames a remote path via `mv`.
   */
  public async move(oldPath: string, newPath: string): Promise<void> {
    const cmd = `mv "${oldPath}" "${newPath}"`;
    await this.executeCommand(cmd);
  }

  /**
   * Counts files under a directory via `find | wc -l`.
   */
  public async count(remoteDir: string): Promise<number> {
    const raw = await this.executeCommand(`find "${remoteDir}" | wc -l`);
    const lines = raw.trim().split('\n');
    const n = parseInt(lines.pop() || '0', 10);
    return isNaN(n) ? 0 : n;
  }

  /** Helper from BaseClient to turn your config into `ssh2` options */
  protected getConnectionOptions(
    cfg: ConfigurationMessage['configuration']
  ): ConnectConfig {
    // implement in BaseClient or override here
    return super.getConnectionOptions(cfg);
  }
}
