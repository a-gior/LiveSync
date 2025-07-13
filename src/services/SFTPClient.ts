// src/services/SFTPClient.ts
import SftpClient from 'ssh2-sftp-client';
import { BaseClient } from './BaseClient';
import { ConfigurationMessage } from '@shared/DTOs/messages/ConfigurationMessage';
import { BaseNodeType } from '../utilities/BaseNode';
import { logInfoMessage, logErrorMessage, LOG_FLAGS } from '../managers/LogManager';

export class SFTPClient extends BaseClient {
  private client = new SftpClient();

  constructor() {
    super();
    this.isConnected  = false;
    this.isConnecting = false;
  }

  /** Establish an SFTP connection using the given configuration. */
  public async connect(config: ConfigurationMessage['configuration']): Promise<void> {
    if (this.isConnected || this.isConnecting) return;

    const options = this.getConnectionOptions(config) as any;
    logInfoMessage(`SFTP: connecting to ${config.hostname}:${config.port}`);
    this.isConnecting = true;

    try {
      await this.waitForConnection();
      await this.client.connect(options);
      this.isConnected  = true;
      this.isConnecting = false;
      logInfoMessage('SFTP: connection ready');
    } catch (err: any) {
      this.isConnected  = false;
      this.isConnecting = false;
      logErrorMessage(
        `SFTP: connection error: ${err.message}`,
        LOG_FLAGS.CONSOLE_ONLY,
        err
      );
      throw err;
    }
  }

  /** Ends the SFTP connection if connected. */
  public async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    logInfoMessage('SFTP: disconnecting');
    await this.client.end();
    this.isConnected = false;
  }

  /** Uploads a local file to the remote path. */
  public async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.client.fastPut(localPath, remotePath);
    logInfoMessage(`SFTP: uploaded ${localPath} → ${remotePath}`);
  }

  /** Downloads a remote file to a local path. */
  public async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await this.client.fastGet(remotePath, localPath);
    logInfoMessage(`SFTP: downloaded ${remotePath} → ${localPath}`);
  }

  /** Creates a remote directory (including parents). */
  public async createDirectory(remoteDir: string): Promise<void> {
    await this.client.mkdir(remoteDir, true);
    logInfoMessage(`SFTP: created directory ${remoteDir}`);
  }

  /** Deletes a remote directory (recursive). */
  public async deleteDirectory(remoteDir: string): Promise<void> {
    await this.client.rmdir(remoteDir, true);
    logInfoMessage(`SFTP: deleted directory ${remoteDir}`);
  }

  /** Deletes a remote file. */
  public async deleteFile(remoteFile: string): Promise<void> {
    await this.client.delete(remoteFile);
    logInfoMessage(`SFTP: deleted file ${remoteFile}`);
  }

  /**
   * Lists files in a remote directory, optionally filtered by a predicate.
   * @param remoteDir path to list
   * @param filterFn optional function to filter the returned entries
   */
  public async listFiles(
    remoteDir: string,
    filterFn?: (info: SftpClient.FileInfo) => boolean
  ): Promise<SftpClient.FileInfo[]> {
    const list = await this.client.list(remoteDir);
    logInfoMessage(`SFTP: listed ${remoteDir}`);
    return filterFn ? list.filter(filterFn) : list;
  }

  /** Retrieves stats for a remote path. */
  public async getFileStats(remotePath: string): Promise<any> {
    const stats = await this.client.stat(remotePath);
    logInfoMessage(`SFTP: stats for ${remotePath}`);
    return stats;
  }

  /** Determines if a path is a file, directory, or missing. */
  public async pathType(remotePath: string): Promise<BaseNodeType | false> {
    const exists = await this.client.exists(remotePath);
    if (!exists) return false;
    if (exists === '-') return BaseNodeType.file;
    if (exists === 'd') return BaseNodeType.directory;
    return false;
  }

  /** Returns true if the remote path exists. */
  public async exists(remotePath: string): Promise<boolean> {
    return (await this.pathType(remotePath)) !== false;
  }
}
