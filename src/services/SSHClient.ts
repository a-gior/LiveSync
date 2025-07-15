// src/services/SSHClient.ts
import { Client, ConnectConfig } from 'ssh2';
import { BaseClient } from './BaseClient';
import { ConfigurationMessage } from '@shared/DTOs/messages/ConfigurationMessage';
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from '../managers/LogManager';

export class SSHClient extends BaseClient {
  private client = new Client();

  public async connect(cfg: ConfigurationMessage['configuration']): Promise<void> {
    await this.guardedConnect(() => {
      const opts = this.getConnectionOptions(cfg);
      return new Promise<void>((resolve, reject) => {
        logInfoMessage(`SSH: connecting to ${cfg.hostname}:${cfg.port}`, LOG_FLAGS.CONSOLE_ONLY);
        this.client
          .on('ready', () => {
            logInfoMessage('SSH: connection ready');
            resolve();
          })
          .on('error', err => {
            logErrorMessage(`SSH: connection error: ${err.message}`, LOG_FLAGS.CONSOLE_ONLY, err);
            reject(err);
          })
          .on('close', () => {
            this.isConnected = false;
            logInfoMessage('SSH: connection closed');
          })
          .on('timeout', () => {
            logErrorMessage('SSH: connection timed out', LOG_FLAGS.CONSOLE_ONLY);
            reject(new Error('SSH connection timed out'));
          })
          .connect(opts);
      });
    });
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    logInfoMessage('SSH: disconnecting');
    this.client.end();
    this.isConnected = false;
  }

  public async executeCommand(
    command: string,
    dataCb?: (line: string) => void
  ): Promise<string> {
    let output = '';
    return new Promise<string>((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let buffer = '';

        const flush = (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split('\n');
          buffer = parts.pop() || '';
          for (const line of parts) {
            dataCb?.(line + '\n');
          }
        };

        stream
          .on('data', (b: Buffer) => { flush(b.toString()); output += b.toString(); })
          .stderr.on('data', (b: Buffer) => { flush(b.toString()); output += b.toString(); })
          .on('close', (code: any, signal: any) => {
            // flush any remainder
            if (buffer && dataCb) dataCb(buffer);

            // normalize for logging
            const exitCode   = code   != null ? code   : -1;
            const exitSignal = signal != null ? signal : 'none';

            // 0 and 1 are “ok” for our use-case
            if (code != null && ![0, 1].includes(code)) {
              return reject(new Error(
                `Command "${command}" failed: code=${exitCode}, signal=${exitSignal}`
              ));
            }

            if (code === 1) {
              logErrorMessage(
                `Command "${command}" exited with code 1 (permissions?)`,
                LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
              );
            }

            resolve(output);
          });
      });
    });
  }

  public async mkdirs(dirs: string[]): Promise<void> {
    if (dirs.length === 0) return;
    const cmd = `mkdir -p ${dirs.map(d => `'${d}'`).join(' ')}`;
    await this.executeCommand(cmd);
  }

  public async move(oldPath: string, newPath: string): Promise<void> {
    await this.executeCommand(`mv "${oldPath}" "${newPath}"`);
  }

  public async count(remoteDir: string): Promise<number> {
    const raw = await this.executeCommand(`find "${remoteDir}" | wc -l`);
    const lastLine = raw.trim().split('\n').pop() || '0';
    return parseInt(lastLine, 10) || 0;
  }
}

