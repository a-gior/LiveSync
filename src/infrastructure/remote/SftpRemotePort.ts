/**
 * SFTP Remote Port - SSH/SFTP operations for remote file synchronization
 * 
 * Uses:
 * - SSH connection pool for list operations
 * - SFTP client with p-limit for file operations
 * - Native OS commands via scanRemote for efficient indexing
 */

import * as fsp from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import SftpClient from 'ssh2-sftp-client';
import { Client as SSHClient } from 'ssh2';
import pLimit from 'p-limit';

import type { RemotePort } from '@app/ports/RemotePort';
import type { WorkspaceId, RelPath, NodeIndex } from '@domain/types';

import { WorkspaceConfigService } from '../config/WorkspaceConfigService';
import { logSync } from '@helpers/logging';
import { sha256OfFile } from '@helpers/hash';
import { scanRemote } from '@helpers/indexing';

const p = path.posix;

const normalize = (pp: string): string => pp.replace(/\\/g, '/');

// ═══════════════════════════════════════════════════════════════════════════
// SSH Connection Pool
// ═══════════════════════════════════════════════════════════════════════════

class SSHConnectionPool {
  private pool: SSHClient[] = [];
  private readonly maxConnections: number;
  private activeConnections = 0;
  private waitQueue: Array<{
    resolve: (client: SSHClient) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(maxConnections: number = 4) {
    this.maxConnections = maxConnections;
  }

  async acquire(cfg: any): Promise<SSHClient> {
    // Check pool for healthy connection
    while (this.pool.length > 0) {
      const idle = this.pool.pop()!;
      if (this.isClientAlive(idle)) {
        this.activeConnections++;
        return idle;
      }
      // Stale connection - close and try next
      try { 
        idle.end(); 
        idle.destroy();
      } catch {
        // Ignore
      }
    }

    // Can create new connection
    if (this.activeConnections < this.maxConnections) {
      this.activeConnections++;
      
      try {
        const client = new SSHClient();
        await this.connectSSH(client, cfg);
        return client;
      } catch (err) {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
        throw err;
      }
    }

    // All connections busy - wait
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitQueue.findIndex(item => item.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error('Timeout waiting for SSH connection (30s)'));
      }, 30000);

      this.waitQueue.push({
        resolve: (client: SSHClient) => {
          clearTimeout(timeoutId);
          resolve(client);
        },
        reject: (err: Error) => {
          clearTimeout(timeoutId);
          if (err.message === 'Connection died, retry') {
            this.acquire(cfg).then(resolve, reject);
          } else {
            reject(err);
          }
        }
      });
    });
  }

  release(client: SSHClient): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);

    if (!this.isClientAlive(client)) {
      try {
        client.end();
        client.destroy();
      } catch {
        // Ignore
      }
      
      if (this.waitQueue.length > 0) {
        const waiter = this.waitQueue.shift()!;
        waiter.reject(new Error('Connection died, retry'));
      }
      return;
    }

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      this.activeConnections++;
      waiter.resolve(client);
      return;
    }

    if (this.pool.length >= 2) {
      try {
        client.end();
        client.destroy();
      } catch {
        // Ignore
      }
      return;
    }

    client.removeAllListeners('error');
    client.once('error', () => {
      this.pool = this.pool.filter(c => c !== client);
      try {
        client.end();
        client.destroy();
      } catch {
        // Ignore
      }
    });
    
    client.once('close', () => {
      this.pool = this.pool.filter(c => c !== client);
    });

    this.pool.push(client);
  }

  private isClientAlive(client: SSHClient): boolean {
    try {
      const stream = (client as any)._sshstream;
      return stream !== undefined && 
            stream._writableState !== undefined &&
            !stream.destroyed &&
            !stream._readableState?.ended;
    } catch {
      return false;
    }
  }

  destroy(): void {
    for (const client of this.pool) {
      client.end();
    }
    this.pool = [];
    this.activeConnections = 0;
    this.waitQueue = [];
  }

  private async connectSSH(client: SSHClient, cfg: any): Promise<void> {
    const key = cfg.data.privateKeyPath
      ? await fsp.readFile(cfg.data.privateKeyPath, 'utf8').catch(() => undefined)
      : undefined;

    return new Promise<void>((resolve, reject) => {
      client
        .on('ready', () => resolve())
        .on('error', reject)
        .connect({
          host: cfg.data.hostname!,
          port: cfg.data.port ?? 22,
          username: cfg.data.username,
          password: cfg.data.password,
          privateKey: key,
          passphrase: cfg.data.passphrase,
          readyTimeout: 10000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
        });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SFTP Concurrency Control
// ═══════════════════════════════════════════════════════════════════════════

const sftpLimit = pLimit(9);

// ═══════════════════════════════════════════════════════════════════════════
// SftpRemotePort Implementation
// ═══════════════════════════════════════════════════════════════════════════

export class SftpRemotePort implements RemotePort {
  private readonly sshConnectionPool: SSHConnectionPool;

  constructor(
    private readonly configService: WorkspaceConfigService,
    private readonly concurrency = 4
  ) {
    this.sshConnectionPool = new SSHConnectionPool(concurrency);
  }

  /**
   * List all files and folders on remote, building a NodeIndex
   * Uses streaming SSH commands for efficient scanning
   */
  async list(workspaceId: WorkspaceId): Promise<NodeIndex> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      return new Map();
    }

    const root = normalize(cfg.data.remotePath);
    const hostKey = `${cfg.data.hostname}:${cfg.data.port ?? 22}`;

    const sshClient = await this.sshConnectionPool.acquire(cfg);

    try {
      return await scanRemote(
        hostKey,
        root,
        [...cfg.ignoreFilter.globs],
        sshClient,
        { includeHashes: true }
      );
    } finally {
      this.sshConnectionPool.release(sshClient);
    }
  }

  /**
   * Upload a file to remote
   */
  async uploadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) {return;}

    await sftpLimit(async () => {
      await this.withSFTP(cfg, async (sftpClient) => {
        const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
        const remoteDir = p.dirname(remoteAbs);
        
        await ensureRemoteDir(sftpClient, remoteDir);
        await sftpClient.fastPut(absLocal, remoteAbs);
        logSync(workspaceId, 'upload', relPath as string);
      });
    });
  }

  /**
   * Download a file from remote
   */
  async downloadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) {return;}

    await sftpLimit(async () => {
      await this.withSFTP(cfg, async (sftpClient) => {
        const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
        const localDir = path.dirname(absLocal);
        
        await fsp.mkdir(localDir, { recursive: true });
        await sftpClient.fastGet(remoteAbs, absLocal);
        logSync(workspaceId, 'download', relPath as string);
      });
    });
  }

  /**
   * Move/rename a file or folder on remote
   */
  async move(
    workspaceId: WorkspaceId,
    oldPath: RelPath,
    newPath: RelPath
  ): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) {return;}
    
    await sftpLimit(async () => {
      await this.withSFTP(cfg, async (sftpClient) => {
        const oldRemoteAbs = joinRemote(cfg.data.remotePath!, oldPath);
        const newRemoteAbs = joinRemote(cfg.data.remotePath!, newPath);
        const remoteDir = p.dirname(newRemoteAbs);

        await ensureRemoteDir(sftpClient, remoteDir);
        await sftpClient.rename(oldRemoteAbs, newRemoteAbs);
        logSync(workspaceId, 'move', newPath);
      });
    });
  }

  /**
   * Delete a file or folder on remote (recursive for folders)
   */
  async deletePath(workspaceId: WorkspaceId, relPath: RelPath): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) {return;}

    await sftpLimit(async () => {
      await this.withSFTP(cfg, async (sftpClient) => {
        const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
        const items = await collectRecursive(sftpClient, remoteAbs);
        
        if (!items.length) {return;}

        // Delete deepest paths first
        const sorted = items.sort((a, b) => depth(b.path) - depth(a.path));
        
        for (const item of sorted) {
          try {
            if (item.type === 'd') {
              await sftpClient.rmdir(item.path);
            } else {
              await sftpClient.delete(item.path);
            }
          } catch (e) {
            const msg = String(e);
            if (!/no such|not found/i.test(msg)) {
              throw e;
            }
          }
        }

        logSync(workspaceId, 'delete', relPath as string);
      });
    });
  }

  /**
   * Get hash of a single remote file
   */
  async getFileHash(workspaceId: WorkspaceId, relPath: RelPath): Promise<string> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) {throw new Error('No remote config');}

    return await this.withSFTP(cfg, async (sftpClient) => {
      const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
      
      const tmpFile = path.join(tmpdir(), `livesync-${Date.now()}-${path.basename(relPath as string)}`);
      try {
        await sftpClient.fastGet(remoteAbs, tmpFile);
        const hash = await sha256OfFile(tmpFile);
        await fsp.unlink(tmpFile);
        return hash;
      } catch (err) {
        await fsp.unlink(tmpFile).catch(() => {});
        throw err;
      }
    });
  }

  /**
   * Execute a command on remote (for testing)
   */
  async executeCommand(workspaceId: WorkspaceId, command: string): Promise<string> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) {throw new Error('No remote config');}

    const sshClient = await this.sshConnectionPool.acquire(cfg);
    try {
      return await this.execSSH(sshClient, command);
    } finally {
      this.sshConnectionPool.release(sshClient);
    }
  }

  /**
   * Execute SSH command (buffered)
   */
  private execSSH(client: SSHClient, cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      client.exec(cmd, (err, stream) => {
        if (err) {return reject(err);}

        stream
          .on('data', (chunk: Buffer) => { output += chunk.toString(); })
          .stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); })
          .on('close', () => resolve(output));
      });
    });
  }

  /**
   * SFTP connection wrapper - creates connection, runs callback, ensures cleanup
   */
  private async withSFTP<T>(
    cfg: Awaited<ReturnType<WorkspaceConfigService['getById']>>,
    callback: (client: SftpClient) => Promise<T>
  ): Promise<T> {
    const sftp = new SftpClient();
    const key = cfg.data.privateKeyPath
      ? await fsp.readFile(cfg.data.privateKeyPath, 'utf8').catch(() => undefined)
      : undefined;

    try {
      await sftp.connect({
        host: cfg.data.hostname!,
        port: cfg.data.port ?? 22,
        username: cfg.data.username,
        password: cfg.data.password,
        privateKey: key,
        passphrase: cfg.data.passphrase,
      });

      return await callback(sftp);
    } finally {
      await sftp.end().catch(() => {});
    }
  }

  dispose(): void {
    this.sshConnectionPool.destroy();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function joinRemote(root: string, rel: string): string {
  const clean = rel.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return p.join(normalize(root), clean);
}

async function ensureRemoteDir(client: SftpClient, remoteDir: string): Promise<void> {
  try {
    await client.mkdir(remoteDir, true as any);
  } catch (e) {
    const msg = (e as any)?.message ?? String(e);
    if (!/exists|already/i.test(msg)) {
      throw e;
    }
  }
}

function depth(remoteAbs: string): number {
  return remoteAbs.split('/').filter(Boolean).length;
}

async function collectRecursive(
  client: SftpClient,
  remoteAbs: string
): Promise<Array<{ path: string; type: 'd' | '-' | 'l' }>> {
  const kind = await client.exists(remoteAbs);
  if (!kind) {
    return [];
  }

  if (kind !== 'd') {
    return [{ path: remoteAbs, type: kind as any }];
  }

  const out: Array<{ path: string; type: 'd' | '-' | 'l' }> = [];
  async function walk(dir: string): Promise<void> {
    const items = await client.list(dir);
    for (const it of items) {
      const child = p.join(dir, it.name);
      if (it.type === 'd') {
        await walk(child);
        out.push({ path: child, type: 'd' });
      } else {
        out.push({ path: child, type: '-' });
      }
    }
  }
  await walk(remoteAbs);
  out.push({ path: remoteAbs, type: 'd' });
  return out;
}