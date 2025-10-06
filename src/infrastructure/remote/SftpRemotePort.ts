import * as fsp from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import SftpClient from 'ssh2-sftp-client';
import { Minimatch } from 'minimatch';
import type { RemotePort } from '../../application/ports/RemotePort';
import type { FileMeta } from '../../domain/types';
import { WorkspaceConfigService } from '../config/WorkspaceConfigService';
import { logInfoMessage } from '../../managers/LogManager';

export class SftpRemotePort implements RemotePort {
  constructor(
    private readonly configService: WorkspaceConfigService,
    private readonly concurrency = 4
  ) {}

  async list(workspaceId: string): Promise<Map<string, FileMeta>> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      return new Map();
    }

    const client = await this.connect(cfg);
    try {
      const root = normalize(cfg.data.remotePath);
      const ignores = compileIgnores(cfg.ignoreGlobs);
      const files = await this.walkFiles(client, root, ignores);

      // bounded hashing
      const out = new Map<string, FileMeta>();
      const queue = files.slice();
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.max(1, this.concurrency); i += 1) {
        workers.push((async () => {
          while (true) {
            const rel = queue.shift();
            if (!rel) { return; }
            try {
              const remoteAbs = joinRemote(root, rel);
              const hash = await sha1OfRemote(client, remoteAbs);
              out.set(rel, { type: 'file', hash });
            } catch(e: any) {
              logInfoMessage(`[LiveSync][SFTP] WARN: skipping "${rel}" — ${e.message}`);
            }
          }
        })());
      }
      await Promise.all(workers);
      return out;
    } finally {
      await client.end().catch(() => {});
    }
  }

  async uploadFile(workspaceId: string, relativePath: string, absoluteLocalPath: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) { throw new Error('Remote is not configured.'); }

    const client = await this.connect(cfg);
    try {
      const target = joinRemote(cfg.data.remotePath, relativePath);
      await ensureRemoteDir(client, path.posix.dirname(normalize(target)));
      await client.fastPut(absoluteLocalPath, normalize(target));
    } finally {
      await client.end().catch(() => {});
    }
  }

  async deletePath(workspaceId: string, relativePath: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) { throw new Error('Remote is not configured.'); }

    const client = await this.connect(cfg);
    try {
      const target = joinRemote(cfg.data.remotePath, relativePath);
      // We delete file paths (folder recursion already expands to files).
      await client.delete(normalize(target)).catch(async (e: any) => {
        // if it’s a dir, try removing recursive
        if (String(e?.message || '').includes('No such file')) { return; }
        try { await client.rmdir(normalize(target), true); } catch { /* ignore */ }
      });
    } finally {
      await client.end().catch(() => {});
    }
  }

  async downloadFile(workspaceId: string, relativePath: string, absoluteLocalPath: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) { throw new Error('Remote is not configured.'); }

    const client = await this.connect(cfg);
    try {
      const remoteAbs = joinRemote(cfg.data.remotePath, relativePath);
      await fsp.mkdir(path.dirname(absoluteLocalPath), { recursive: true });
      await client.fastGet(normalize(remoteAbs), absoluteLocalPath);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // ---- helpers

  private async connect(cfg: Awaited<ReturnType<WorkspaceConfigService['getById']>>): Promise<SftpClient> {
    const sftp = new SftpClient();
    const key = cfg.data.privateKeyPath ? await fsp.readFile(cfg.data.privateKeyPath, 'utf8').catch(() => undefined) : undefined;
    await sftp.connect({
      host: cfg.data.hostname!,
      port: cfg.data.port ?? 22,
      username: cfg.data.username,
      password: cfg.data.password,
      privateKey: key,
      passphrase: cfg.data.passphrase
    });
    return sftp;
  }

  private async walkFiles(client: SftpClient, remoteRoot: string, ignores: Minimatch[]): Promise<string[]> {
    const results: string[] = [];
    async function walk(dirAbs: string, rel: string) {
      const list = await client.list(normalize(dirAbs));
      for (const entry of list) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (shouldIgnore(relPath, ignores)) { continue; }

        if (entry.type === 'd') {
          await walk(joinRemote(remoteRoot, relPath), relPath);
        } else if (entry.type === '-' || entry.type === 'l') {
          results.push(relPath);
        }
      }
    }
    await walk(normalize(remoteRoot), '');
    return results;
  }
}

function normalize(p: string): string { return p.replace(/\\/g, '/'); }

function joinRemote(root: string, rel: string): string {
  const r = normalize(root).replace(/\/+$/, '');
  const rr = normalize(rel).replace(/^\/+/, '');
  return `${r}/${rr}`;
}

function compileIgnores(globs: string[]): Minimatch[] {
  return globs.map((g) => new Minimatch(g, { dot: true, nocase: true, nocomment: true }));
}

function shouldIgnore(rel: string, rules: Minimatch[]): boolean {
  return rules.some((mm) => mm.match(rel));
}

async function ensureRemoteDir(client: SftpClient, dirAbs: string): Promise<void> {
  const parts = dirAbs.split('/').filter(Boolean);
  let cur = dirAbs.startsWith('/') ? '/' : '';
  for (const part of parts) {
    cur = cur ? `${cur.replace(/\/$/, '')}/${part}` : part;
    try { await client.mkdir(cur); } catch {}
  }
}

async function sha1OfRemote(client: SftpClient, remoteAbs: string): Promise<string> {
  const hash = createHash('sha1');
  // Do NOT pass a destination; we want the data back.
  const res: unknown = await client.get(normalize(remoteAbs));

  // Buffer?
  if (Buffer.isBuffer(res)) {
    hash.update(res);
    return hash.digest('hex');
  }

  // String?
  if (typeof res === 'string') {
    hash.update(Buffer.from(res));
    return hash.digest('hex');
  }

  // Uint8Array (some versions return a typed array)
  if (res instanceof Uint8Array) {
    hash.update(Buffer.from(res));
    return hash.digest('hex');
  }

  // Readable stream?
  const maybe: any = res as any;
  if (maybe && typeof maybe.on === 'function') {
    return new Promise<string>((resolve, reject) => {
      maybe.on('data', (chunk: Buffer | string | Uint8Array) => hash.update(chunk as any));
      maybe.on('error', reject);
      maybe.on('end', () => resolve(hash.digest('hex')));
    });
  }

  // Last resort: stringify the value (prevents crash)
  hash.update(Buffer.from(String(res ?? '')));
  return hash.digest('hex');
}

