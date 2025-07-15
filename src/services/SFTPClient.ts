// src/services/SFTPClient.ts
import SftpClient from 'ssh2-sftp-client';
import { BaseClient } from './BaseClient';
import { ConfigurationMessage } from '@shared/DTOs/messages/ConfigurationMessage';
import { BaseNodeType } from '../utilities/BaseNode';
import { logInfoMessage } from '../managers/LogManager';

export class SFTPClient extends BaseClient {
  private client = new SftpClient();

  public async connect(cfg: ConfigurationMessage['configuration']): Promise<void> {
    await this.guardedConnect(async () => {
      const opts = this.getConnectionOptions(cfg) as any;
      logInfoMessage(`SFTP: connecting to ${cfg.hostname}:${cfg.port}`);
      await this.client.connect(opts);
      logInfoMessage('SFTP: connection ready');
    });
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    logInfoMessage('SFTP: disconnecting');
    await this.client.end();
    this.isConnected = false;
  }

  public async uploadFile(local: string, remote: string): Promise<void> {
    await this.client.fastPut(local, remote);
    logInfoMessage(`SFTP: uploaded ${local} → ${remote}`);
  }

  public async downloadFile(remote: string, local: string): Promise<void> {
    await this.client.fastGet(remote, local);
    logInfoMessage(`SFTP: downloaded ${remote} → ${local}`);
  }

  public async mkdir(remoteDir: string): Promise<void> {
    await this.client.mkdir(remoteDir, true);
    logInfoMessage(`SFTP: created directory ${remoteDir}`);
  }

  public async rmdir(remoteDir: string): Promise<void> {
    await this.client.rmdir(remoteDir, true);
    logInfoMessage(`SFTP: deleted directory ${remoteDir}`);
  }

  public async delete(remoteFile: string): Promise<void> {
    await this.client.delete(remoteFile);
    logInfoMessage(`SFTP: deleted file ${remoteFile}`);
  }

  public async listFiles(
    remoteDir: string,
    filterFn?: (info: SftpClient.FileInfo) => boolean
  ): Promise<SftpClient.FileInfo[]> {
    const list = await this.client.list(remoteDir);
    logInfoMessage(`SFTP: listed ${remoteDir}`);
    return filterFn ? list.filter(filterFn) : list;
  }

  public async getFileStats(remotePath: string): Promise<SftpClient.FileStats> {
    const stats = await this.client.stat(remotePath);
    logInfoMessage(`SFTP: stats for ${remotePath}`);
    return stats;
  }

  public async pathType(remotePath: string): Promise<BaseNodeType | false> {
    const exists = await this.client.exists(remotePath);
    if (!exists) return false;
    if (exists === '-') return BaseNodeType.file;
    if (exists === 'd') return BaseNodeType.directory;
    return false;
  }

  public async exists(remotePath: string): Promise<boolean> {
    return (await this.pathType(remotePath)) !== false;
  }
}
