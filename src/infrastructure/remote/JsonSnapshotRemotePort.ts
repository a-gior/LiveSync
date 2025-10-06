import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { RemotePort } from '@app/ports/RemotePort';
import type { FileMeta } from '@domain/types';

export class JsonSnapshotRemotePort implements RemotePort {
  constructor(private readonly fileName = 'remote-index.json') {}

  async list(workspaceId: string): Promise<Map<string, FileMeta>> {
    const filePath = this.snapshotPath(workspaceId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, FileMeta>;
      return new Map<string, FileMeta>(Object.entries(obj));
    } catch {
      return new Map();
    }
  }

  async uploadFile(workspaceId: string, relativePath: string, absoluteLocalPath: string): Promise<void> {
    const index = await this.list(workspaceId);
    const hash = await sha1OfFile(absoluteLocalPath);
    index.set(relativePath.replace(/\\/g, '/'), { type: 'file', hash });
    await this.save(workspaceId, index);
  }

  async deletePath(workspaceId: string, relativePath: string): Promise<void> {
    const index = await this.list(workspaceId);
    const key = relativePath.replace(/\\/g, '/');
    const prefix = key.endsWith('/') ? key : key + '/';
    for (const k of Array.from(index.keys())) {
      if (k === key || k.startsWith(prefix)) {
        index.delete(k);
      }
    }
    await this.save(workspaceId, index);
  }

  async downloadFile(_workspaceId: string, _relativePath: string, _absoluteLocalPath: string): Promise<void> {
    // Not possible with metadata-only JSON snapshot (no file contents).
    throw new Error('JsonSnapshotRemotePort: downloadFile is not supported.');
  }

  // ---- helpers
  private async save(workspaceId: string, data: Map<string, FileMeta>): Promise<void> {
    const filePath = this.snapshotPath(workspaceId);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const obj = Object.fromEntries(data.entries());
    await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
  }

  private snapshotPath(workspaceId: string): string {
    return path.join(workspaceId, '.livesync', this.fileName);
  }
}

async function sha1OfFile(fsPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = fssync.createReadStream(fsPath);
    stream.on('data', (chunk) => { hash.update(chunk); });
    stream.on('error', (e) => { reject(e); });
    stream.on('end', () => { resolve(hash.digest('hex')); });
  });
}
