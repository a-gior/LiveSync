import * as fsp from 'fs/promises';
import * as path from 'path';
import SftpClient from 'ssh2-sftp-client';
import { Minimatch } from 'minimatch';
import { Client as SSHClient } from 'ssh2';

import type { RemotePort } from '@app/ports/RemotePort';
import type { WorkspaceId, RelPath, NodeIndex, FolderMeta, FileMeta } from '@domain/types';

import { WorkspaceConfigService } from '../config/WorkspaceConfigService';
import { asRel } from '@helpers/path/RelPath';
import { logInfoMessage } from '@helpers/logging';
import { computeAllFolderHashes } from '../helpers/hash';

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

    // Use batched SSH listing instead of recursive SFTP
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
      await this.connectSSH(sshClient, cfg);

      const out: NodeIndex = new Map();
      
      const [filesAndDirsRaw, filesHashRaw] = await Promise.all([
        // Command 1: Get ALL entries (files + dirs) with type and stat in one pass
        // Using -printf is faster than piping to stat
        this.execSSH(sshClient, 
          `find "${root}" -printf '%p|%y|%s|%T@\\n' 2>/dev/null || true`
        ),
        
        // Command 2: Get hashes only (can't combine with stat efficiently)
        // Using -print0 with xargs is faster for large datasets
        this.execSSH(sshClient, 
          `find "${root}" -type f -print0 2>/dev/null | xargs -0 -P4 -n100 sha256sum 2>/dev/null | sed -E "s|\\s+${root}/|,|" || true`
        )
      ]);

      // Pre-allocate maps with estimated capacity
      const files: Array<{ rel: RelPath; size: number; mtime: number }> = [];
      const folders = new Set<RelPath>();
      
      // Single-pass parsing with minimal string operations
      const lines = filesAndDirsRaw.split('\n');
      const rootLen = root.length;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        
        const parts = line.split('|');
        if (parts.length < 4) continue;

        const fullPath = parts[0];
        const type = parts[1];
        
        // Fast path calculation without creating intermediate strings
        let rel: string;
        if (fullPath === root) {
          rel = '';
        } else if (fullPath.length > rootLen && fullPath[rootLen] === '/' && fullPath.startsWith(root)) {
          rel = fullPath.substring(rootLen + 1);
        } else {
          continue;
        }

        const relPath = asRel(rel);
        if (shouldIgnore(relPath, ignores)) continue;

        if (type === 'd') {
          folders.add(relPath);
        } else if (type === 'f') {
          // Parse size and mtime inline
          const size = parseInt(parts[2], 10) || 0;
          const mtime = Math.floor(parseFloat(parts[3]) * 1000);
          files.push({ rel: relPath, size, mtime });
        }
      }

      // Parse hashes into a Map once
      const fileHashMap = new Map<string, string>();
      const hashLines = filesHashRaw.split('\n');
      
      for (let i = 0; i < hashLines.length; i++) {
        const line = hashLines[i];
        if (!line) continue;
        
        const commaIdx = line.indexOf(',');
        if (commaIdx === -1) continue;
        
        // Direct substring instead of split
        const hash = line.substring(0, commaIdx);
        const relPath = line.substring(commaIdx + 1);
        
        if (hash && relPath) {
          fileHashMap.set(relPath, hash);
        }
      }

      // Batch add to index (fewer map operations)
      // Add folders first
      for (const folderRel of folders) {
        out.set(folderRel, { type: 'folder', hash: '' } as FolderMeta);
      }

      // Add files with their hashes
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const hash = fileHashMap.get(file.rel as string) || '';
        
        out.set(file.rel, { 
          type: 'file', 
          hash 
        } as FileMeta);
      }

      // Compute folder hashes bottom-up
      await computeAllFolderHashes(out);

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

  private async connectSSH(client: SSHClient, cfg: Awaited<ReturnType<WorkspaceConfigService['getById']>>): Promise<void> {
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
