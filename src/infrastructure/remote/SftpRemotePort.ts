import * as fsp from 'fs/promises';
import * as path from 'path';
import SftpClient from 'ssh2-sftp-client';
import { Minimatch } from 'minimatch';

import type { RemotePort } from '@app/ports/RemotePort';
import type { WorkspaceId, RelPath, NodeIndex, NodeMeta } from '@domain/types';

import { WorkspaceConfigService } from '../config/WorkspaceConfigService';
import { sha1FromSftpGetResult } from './SftpHashCore';
import { asRel } from '@helpers/path/RelPath';
import { logInfoMessage } from '@helpers/logging';

const p = path.posix;

const normalize = (pp: string): string => pp.replace(/\\/g, '/');

export class SftpRemotePort implements RemotePort {
  constructor(
    private readonly configService: WorkspaceConfigService,
    private readonly concurrency = 4
  ) {}

  async list(workspaceId: WorkspaceId): Promise<NodeIndex> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      return new Map();
    }

    const client = await this.connect(cfg);
    try {
      const root = normalize(cfg.data.remotePath);
      const ignores = compileIgnores(cfg.ignoreGlobs);
      const { files, dirs } = await this.walkFilesAndDirs(client, root, ignores);

      const out: NodeIndex = new Map();

      // 1) Emit folder nodes first (so empty dirs show up)
      for (const dirRel of dirs) {
        const rel = asRel(dirRel);
        out.set(rel, { type: 'folder', hash: '' } as NodeMeta);
      }

      // 2) Hash files with bounded concurrency
      const queue = files.slice();
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.max(1, this.concurrency); i += 1) {
        workers.push((async () => {
          while (true) {
            const rel = queue.shift();
            if (!rel) {
              return;
            }
            try {
              const remoteAbs = joinRemote(root, rel);
              const hash = await sha1OfRemote(client, remoteAbs);
              out.set(asRel(rel), { type: 'file', hash } as NodeMeta);
            } catch (e: any) {
              logInfoMessage(`[LiveSync][SFTP] WARN: skipping "${rel}" — ${e?.message ?? e}`);
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

  async uploadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      throw new Error('No remote configured');
    }
    const client = await this.connect(cfg);
    try {
      const root = normalize(cfg.data.remotePath);
      const remoteAbs = joinRemote(root, relPath as string);
      const parent = p.dirname(remoteAbs);
      await ensureRemoteDir(client, parent);
      await client.fastPut(absLocal, remoteAbs);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async deletePath(workspaceId: WorkspaceId, relPath: RelPath): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      throw new Error('No remote configured');
    }
    const client = await this.connect(cfg);
    try {
      const root = normalize(cfg.data.remotePath);
      const abs = joinRemote(root, relPath as string);

      // Guard: never delete the configured root
      if (abs === root || abs === p.normalize(root + '/')) {
        throw new Error('Refusing to delete remote root');
      }

      const plan = await collectRecursive(client, abs);
      if (plan.length === 0) {
        return; // nothing there
      }

      // Delete children before parents (depth-desc)
      plan.sort((a, b) => depth(b.path) - depth(a.path));

      let files = 0;
      let dirs = 0;
      for (const node of plan) {
        try {
          if (node.type === 'd') {
            await client.rmdir(node.path, false as any);
            dirs += 1;
          } else {
            await client.delete(node.path);
            files += 1;
          }
        } catch (e) {
          logInfoMessage(`[LiveSync][SFTP] WARN: skip deleting ${node.path} — ${(e as any)?.message ?? e}`);
        }
      }
      logInfoMessage(`[LiveSync][SFTP] Deleted ${files} file(s), ${dirs} folder(s) under ${relPath as string}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async downloadFile(workspaceId: WorkspaceId, relativePath: RelPath, absoluteLocalPath: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      throw new Error('Remote is not configured.');
    }

    const client = await this.connect(cfg);
    try {
      const remoteAbs = joinRemote(cfg.data.remotePath, relativePath as string);
      await fsp.mkdir(path.dirname(absoluteLocalPath), { recursive: true });
      await client.fastGet(normalize(remoteAbs), absoluteLocalPath);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // ---- helpers --------------------------------------------------------------

  private async connect(cfg: Awaited<ReturnType<WorkspaceConfigService['getById']>>): Promise<SftpClient> {
    const sftp = new SftpClient();
    const key = cfg.data.privateKeyPath
      ? await fsp.readFile(cfg.data.privateKeyPath, 'utf8').catch(() => undefined)
      : undefined;

    await sftp.connect({
      host: cfg.data.hostname!,
      port: cfg.data.port ?? 22,
      username: cfg.data.username,
      password: cfg.data.password,
      privateKey: key,
      passphrase: cfg.data.passphrase,
    });
    return sftp;
  }

  private async walkFilesAndDirs(
    client: SftpClient,
    remoteRoot: string,
    ignores: Minimatch[]
  ): Promise<{ files: string[]; dirs: string[] }> {
    const files: string[] = [];
    const dirs: string[] = [];

    async function walk(dirAbs: string, rel: string): Promise<void> {
      const entries = await client.list(normalize(dirAbs));

      // Track the directory itself (skip root '')
      if (rel) {
        if (!shouldIgnore(rel, ignores)) {
          dirs.push(rel);
        }
      }

      for (const entry of entries) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (shouldIgnore(relPath, ignores)) {
          continue;
        }

        const childAbs = p.join(dirAbs, entry.name);
        if (entry.type === 'd') {
          await walk(childAbs, relPath);
        } else if (entry.type === '-' || entry.type === 'l') {
          files.push(relPath);
        }
      }
    }

    await walk(normalize(remoteRoot), '');
    return { files, dirs };
  }
}

// ---------- file-local helpers ------------------------------------------------

function compileIgnores(globs: string[]): Minimatch[] {
  return globs.map((g) => new Minimatch(g, { dot: true, nocase: true, nocomment: true }));
}

function shouldIgnore(rel: string, rules: Minimatch[]): boolean {
  return rules.some((mm) => mm.match(rel));
}

async function sha1OfRemote(client: SftpClient, remoteAbs: string): Promise<string> {
  // IMPORTANT: do NOT pass a 'dst' argument; we want the data back
  const result = await client.get(normalize(remoteAbs));
  return sha1FromSftpGetResult(result);
}

function joinRemote(root: string, rel: string): string {
  const clean = rel.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return p.join(normalize(root), clean);
}

async function ensureRemoteDir(client: SftpClient, remoteDir: string): Promise<void> {
  try {
    // ssh2-sftp-client: mkdir(dir, recursive=true)
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
  const kind = await client.exists(remoteAbs); // 'd' | '-' | 'l' | false
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
  out.push({ path: remoteAbs, type: 'd' }); // include the directory itself last
  return out;
}
