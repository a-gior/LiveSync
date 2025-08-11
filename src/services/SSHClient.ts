// src/services/SSHClient.ts
import { Client } from 'ssh2';
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
    if (!this.isConnected) {return;}
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
        if (err) {return reject(err);}

        let exitCode: number | null = null;
        let exitSignal: string | null = null;
        let buffer = '';

        // 1️⃣ Listen for the real exit event
        stream.on('exit', (code: number | null, signal: string | null) => {
          exitCode   = code;
          exitSignal = signal;
        });

        // 2️⃣ Data handler (unchanged)
        const flush = (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split('\n');
          buffer = parts.pop() || '';
          for (const line of parts) {
            dataCb?.(line + '\n');
          }
        };
        stream
          .on('data',    (b: Buffer) => { flush(b.toString()); output += b; })
          .stderr.on('data', (b: Buffer) => { flush(b.toString()); output += b; });

        // 3️⃣ Close handler––now exitCode & exitSignal are set
        stream.on('close', () => {
          if (buffer && dataCb) {dataCb(buffer);}

          // treat undefined (never set) same as null
          const code   = exitCode   !== null ? exitCode   : -1;
          const signal = exitSignal !== null ? exitSignal : 'none';

          if (![0, 1].includes(code)) {
            return reject(new Error(
              `Command "${command}" failed: code=${code}, signal=${signal}`
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
    if (dirs.length === 0) {return;}
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

