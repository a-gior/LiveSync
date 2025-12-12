import * as fsp from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import SftpClient from 'ssh2-sftp-client';
import { Client as SSHClient } from 'ssh2';
import pLimit from 'p-limit';

import type { RemotePort } from '@app/ports/RemotePort';
import type { WorkspaceId, RelPath, NodeIndex, FolderMeta, FileMeta } from '@domain/types';

import { WorkspaceConfigService } from '../config/WorkspaceConfigService';
import { asRel } from '@helpers/path/RelPath';
import { logInfoMessage } from '@helpers/logging';
import { computeAllFolderHashes, sha256OfFile } from '../helpers/hash';
import { IgnoreFilter } from '../helpers/ignore';

const p = path.posix;

const normalize = (pp: string): string => pp.replace(/\\/g, '/');

/**
 * Connection pool for managing SSH connections (for list operations)
 */
class SSHConnectionPool {
  private pool: SSHClient[] = [];
  private readonly maxConnections: number;
  private activeConnections = 0;
  private waitQueue: Array<(client: SSHClient) => void> = [];

  constructor(maxConnections: number = 4) {
    this.maxConnections = maxConnections;
  }

  async acquire(cfg: any): Promise<SSHClient> {
    const idle = this.pool.pop();
    if (idle) {
      this.activeConnections++;
      return idle;
    }

    if (this.activeConnections < this.maxConnections) {
      this.activeConnections++;
      const client = new SSHClient();
      await this.connectSSH(client, cfg);
      return client;
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(client: SSHClient): void {
    this.activeConnections--;

    const waiter = this.waitQueue.shift();
    if (waiter) {
      this.activeConnections++;
      waiter(client);
      return;
    }

    if (this.pool.length < 2) {
      this.pool.push(client);
    } else {
      client.end();
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
        });
    });
  }
}

/**
 * Use p-limit library for elegant concurrency control
 * Set limit to 9 to avoid event listener warnings (from 10 onwards)
 */
const sftpLimit = pLimit(9);

export class SftpRemotePort implements RemotePort {
  private readonly sshConnectionPool: SSHConnectionPool;

  constructor(
    private readonly configService: WorkspaceConfigService,
    private readonly concurrency = 4
  ) {
    this.sshConnectionPool = new SSHConnectionPool(concurrency);
  }

  async list(workspaceId: WorkspaceId): Promise<NodeIndex> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      return new Map();
    }

    const root = normalize(cfg.data.remotePath);

    return await this.listViaBatchedSSH(cfg, root, cfg.ignoreFilter);
  }

  private async listViaBatchedSSH(
    cfg: Awaited<ReturnType<WorkspaceConfigService['getById']>>,
    root: string,
    ignoreFilter: IgnoreFilter 
  ): Promise<NodeIndex> {
    const sshClient = await this.sshConnectionPool.acquire(cfg);

    try {
      const out: NodeIndex = new Map();
      
      const [filesAndDirsRaw, filesHashRaw] = await Promise.all([
        this.execSSH(sshClient, 
          `find "${root}" -printf '%p|%y|%s|%T@\\n' 2>/dev/null || true`
        ),
        this.execSSH(sshClient, 
          `find "${root}" -type f -print0 2>/dev/null | xargs -0 -P4 -n100 sha256sum 2>/dev/null | sed -E "s|\\s+${root}/|,|" || true`
        )
      ]);

      const files: Array<{ rel: RelPath; size: number; mtime: number }> = [];
      const folders = new Set<RelPath>();
      
      const lines = filesAndDirsRaw.split('\n');
      const rootLen = root.length;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        
        const parts = line.split('|');
        if (parts.length < 4) continue;

        const fullPath = parts[0];
        const type = parts[1];
        
        let rel: string;
        if (fullPath === root) {
          rel = '';
        } else if (fullPath.length > rootLen && fullPath[rootLen] === '/' && fullPath.startsWith(root)) {
          rel = fullPath.substring(rootLen + 1);
        } else {
          continue;
        }

        const relPath = asRel(rel);
        
        if (ignoreFilter.shouldIgnore(relPath)) {  // ← Simplified
          continue;
        }

        if (type === 'd') {
          folders.add(relPath);
        } else if (type === 'f') {
          const size = parseInt(parts[2], 10) || 0;
          const mtime = Math.floor(parseFloat(parts[3]) * 1000);
          files.push({ rel: relPath, size, mtime });
        }
      }

      const fileHashMap = new Map<string, string>();
      const hashLines = filesHashRaw.split('\n');
      
      for (let i = 0; i < hashLines.length; i++) {
        const line = hashLines[i];
        if (!line) continue;
        
        const commaIdx = line.indexOf(',');
        if (commaIdx === -1) continue;
        
        const hash = line.substring(0, commaIdx);
        const relPath = line.substring(commaIdx + 1);
        
        if (hash && relPath) {
          fileHashMap.set(relPath, hash);
        }
      }

      for (const folderRel of folders) {
        out.set(folderRel, { type: 'folder', hash: '' } as FolderMeta);
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const hash = fileHashMap.get(file.rel as string) || '';
        
        out.set(file.rel, { 
          type: 'file', 
          hash 
        } as FileMeta);
      }

      await computeAllFolderHashes(out);

      return out;

    } finally {
      this.sshConnectionPool.release(sshClient);
    }
  }

  private execSSH(client: SSHClient, cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      client.exec(cmd, (err, stream) => {
        if (err) return reject(err);

        stream
          .on('data', (chunk: Buffer) => { output += chunk.toString(); })
          .stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); })
          .on('close', () => resolve(output));
      });
    });
  }

  /**
   * ✅ KEY INSIGHT FROM OLD CODE:
   * Use withSFTP pattern - create connection, use it, then close it
   * Use p-limit to control concurrency elegantly
   */
  async uploadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) return;

    // Use p-limit to control concurrency (max 9 concurrent operations)
    await sftpLimit(async () => {
      await this.withSFTP(cfg, async (sftpClient) => {
        const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
        const remoteDir = p.dirname(remoteAbs);
        
        // Ensure parent directory exists
        await ensureRemoteDir(sftpClient, remoteDir);
        await sftpClient.fastPut(absLocal, remoteAbs);
      });
    });
  }

  async downloadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) return;

    await sftpLimit(async () => {
      await this.withSFTP(cfg, async (sftpClient) => {
        const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
        const localDir = path.dirname(absLocal);
        
        await fsp.mkdir(localDir, { recursive: true });
        await sftpClient.fastGet(remoteAbs, absLocal);
      });
    });
  }

  /**
   * Upload multiple files in a folder with concurrent SFTP connections.
   * Returns array of successfully uploaded RelPaths.
   */
  async uploadFolder(
    workspaceId: WorkspaceId,
    files: Array<{ relPath: RelPath; absLocal: string }>
  ): Promise<RelPath[]> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) return [];

    const uploaded: RelPath[] = [];
    const errors: Array<{ path: RelPath; error: string }> = [];

    await Promise.all(
      files.map((f) =>
        sftpLimit(async () => {
          try {
            await this.withSFTP(cfg, async (sftpClient) => {
              const remoteAbs = joinRemote(cfg.data.remotePath!, f.relPath as string);
              const remoteDir = p.dirname(remoteAbs);
              
              await ensureRemoteDir(sftpClient, remoteDir);
              await sftpClient.fastPut(f.absLocal, remoteAbs);
            });
            uploaded.push(f.relPath);
          } catch (e: any) {
            errors.push({ path: f.relPath, error: e?.message ?? String(e) });
          }
        })
      )
    );

    if (errors.length > 0) {
      logInfoMessage(`[LiveSync][SFTP] Upload errors: ${errors.map(e => `${e.path}: ${e.error}`).join('; ')}`);
    }

    return uploaded;
  }

  /**
   * Download multiple files in a folder with concurrent SFTP connections.
   * Returns array of successfully downloaded RelPaths.
   */
  async downloadFolder(
    workspaceId: WorkspaceId,
    files: Array<{ relPath: RelPath; absLocal: string }>
  ): Promise<RelPath[]> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) return [];

    const downloaded: RelPath[] = [];
    const errors: Array<{ path: RelPath; error: string }> = [];

    await Promise.all(
      files.map((f) =>
        sftpLimit(async () => {
          try {
            await this.withSFTP(cfg, async (sftpClient) => {
              const remoteAbs = joinRemote(cfg.data.remotePath!, f.relPath as string);
              const localDir = path.dirname(f.absLocal);
              
              await fsp.mkdir(localDir, { recursive: true });
              await sftpClient.fastGet(remoteAbs, f.absLocal);
            });
            downloaded.push(f.relPath);
          } catch (e: any) {
            errors.push({ path: f.relPath, error: e?.message ?? String(e) });
          }
        })
      )
    );

    if (errors.length > 0) {
      logInfoMessage(`[LiveSync][SFTP] Download errors: ${errors.map(e => `${e.path}: ${e.error}`).join('; ')}`);
    }

    return downloaded;
  }

  async deletePath(workspaceId: WorkspaceId, relPath: RelPath): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) return;

    await sftpLimit(async () => {
      await this.withSFTP(cfg, async (sftpClient) => {
        const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
        const items = await collectRecursive(sftpClient, remoteAbs);
        
        if (!items.length) return;

        let fileCount = 0;
        let folderCount = 0;

        // Delete deepest paths first
        const sorted = items.sort((a, b) => depth(b.path) - depth(a.path));
        
        for (const item of sorted) {
          try {
            if (item.type === 'd') {
              await sftpClient.rmdir(item.path);
              folderCount++;
            } else {
              await sftpClient.delete(item.path);
              fileCount++;
            }
          } catch (e) {
            const msg = String(e);
            if (!/no such|not found/i.test(msg)) {
              throw e;
            }
          }
        }

        logInfoMessage(`[LiveSync][SFTP] Deleted ${fileCount} file(s), ${folderCount} folder(s) under ${relPath}`);
      });
    });
  }

  async getFileHash(workspaceId: WorkspaceId, relPath: RelPath): Promise<string> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote) throw new Error('No remote config');

    return await this.withSFTP(cfg, async (sftpClient) => {
      const remoteAbs = joinRemote(cfg.data.remotePath!, relPath as string);
      
      // Download to temp buffer and hash it
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
   * ✅ PATTERN FROM OLD CODE:
   * withSFTP - Creates connection, runs callback, ensures cleanup
   * This is more reliable than connection pooling for SFTP
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
      // Always close the connection
      await sftp.end().catch(() => {
        // Ignore cleanup errors
      });
    }
  }

  dispose(): void {
    this.sshConnectionPool.destroy();
  }
}

// ---------- file-local helpers ------------------------------------------------

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