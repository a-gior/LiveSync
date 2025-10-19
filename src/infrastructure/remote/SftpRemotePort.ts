import * as fsp from 'fs/promises';
import * as path from 'path';
import SftpClient from 'ssh2-sftp-client';
import { Minimatch } from 'minimatch';
import { Client as SSHClient } from 'ssh2';

import type { RemotePort } from '@app/ports/RemotePort';
import type { WorkspaceId, RelPath, NodeIndex, NodeMeta } from '@domain/types';

import { WorkspaceConfigService } from '../config/WorkspaceConfigService';
import { asRel, relFromAbs } from '@helpers/path/RelPath';
import { logExpectedError, logInfoMessage } from '@helpers/logging';

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

    const root = normalize(cfg.data.remotePath);
    const ignores = compileIgnores(cfg.ignoreGlobs);

    // NEW: Use batched SSH listing instead of recursive SFTP
    return await this.listViaBatchedSSH(cfg, root, ignores);
  }

  private async listViaBatchedSSH(
    cfg: Awaited<ReturnType<WorkspaceConfigService['getById']>>,
    root: string,
    ignores: Minimatch[]
  ): Promise<NodeIndex> {
    const sshClient = new SSHClient();

    try {
      // Connect SSH
      await new Promise<void>((resolve, reject) => {
        const key = cfg.data.privateKeyPath
          ? fsp.readFile(cfg.data.privateKeyPath, 'utf8').catch(() => undefined)
          : Promise.resolve(undefined);

        key.then((privateKey) => {
          sshClient
            .on('ready', () => resolve())
            .on('error', reject)
            .connect({
              host: cfg.data.hostname!,
              port: cfg.data.port ?? 22,
              username: cfg.data.username,
              password: cfg.data.password,
              privateKey,
              passphrase: cfg.data.passphrase,
              readyTimeout: 10000,
            });
        }).catch(reject);
      });

      // Execute batched find + stat + hash commands
      const out: NodeIndex = new Map();

      // 1) List all files and directories with metadata in ONE command
      const findCmd = `find "${root}" -printf '%p|%y|%s|%T@\\n' 2>/dev/null || true`;
      const findOutput = await this.execSSH(sshClient, findCmd);

      const filesForHashing: Array<{ rel: RelPath; abs: string }> = [];
      const lines = findOutput.split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length < 4) continue;

        const [absPath, type, ] = parts; // [absPath, type, sizeStr]
        const rel = relFromAbs(root, absPath);
        
        if (shouldIgnore(rel, ignores)) continue;

        if (type === 'd') {
          // Directory
          out.set(asRel(rel), { type: 'folder', hash: '' } as NodeMeta);
        } else if (type === 'f') {
          // File - defer hashing
          filesForHashing.push({ rel: asRel(rel), abs: absPath });
        }
      }

      // 2) Hash all files with limited concurrency
      const queue = filesForHashing.slice();
      const workers: Promise<void>[] = [];

      for (let i = 0; i < Math.max(1, this.concurrency); i += 1) {
        workers.push((async () => {
          while (queue.length > 0) {
            const file = queue.shift();
            if (!file) break;

            try {
              // Use SHA256 via SSH (faster than downloading via SFTP)
              const hashCmd = `sha256sum "${file.abs}" 2>/dev/null | awk '{print $1}' || echo "__error__"`;
              const hash = (await this.execSSH(sshClient, hashCmd)).trim();
              
              if (hash && hash !== '__error__') {
                out.set(file.rel, { type: 'file', hash } as NodeMeta);
              } else {
                logExpectedError(`SftpRemotePort:hash:${file.rel}`, new Error('Hash command failed'));
              }
            } catch (err) {
              logExpectedError(`SftpRemotePort:hash:${file.rel}`, err);
            }
          }
        })());
      }

      await Promise.all(workers);

      return out;

    } finally {
      sshClient.end();
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

  async uploadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    const cfg = await this.configService.getById(workspaceId);
    if (!cfg.hasRemote || !cfg.data.remotePath) {
      throw new Error('No remote configured');
    }
    const client = await this.connectSFTP(cfg);
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
    const client = await this.connectSFTP(cfg);
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

    const client = await this.connectSFTP(cfg);
    try {
      const remoteAbs = joinRemote(cfg.data.remotePath, relativePath as string);
      await fsp.mkdir(path.dirname(absoluteLocalPath), { recursive: true });
      await client.fastGet(normalize(remoteAbs), absoluteLocalPath);
    } finally {
      await client.end().catch(() => {});
    }
  }

  // ---- helpers --------------------------------------------------------------

  private async connectSFTP(cfg: Awaited<ReturnType<WorkspaceConfigService['getById']>>): Promise<SftpClient> {
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
}

// ---------- file-local helpers ------------------------------------------------

function compileIgnores(globs: string[]): Minimatch[] {
  return globs.map((g) => new Minimatch(g, { dot: true, nocase: true, nocomment: true }));
}

function shouldIgnore(rel: string|RelPath, rules: Minimatch[]): boolean {
  return rules.some((mm) => mm.match(rel));
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
