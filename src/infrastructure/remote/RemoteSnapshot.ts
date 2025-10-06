import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileMeta } from '@domain/types';

export interface RemoteSnapshot {
  load(workspaceId: string): Promise<Map<string, FileMeta>>;
  save(workspaceId: string, data: Map<string, FileMeta>): Promise<void>;
}

/**
 * Stores one JSON file per workspace at:
 *   <workspace>/.livesync/remote-index.json
 * Shape: { [path: string]: FileMeta }
 */
export class JsonRemoteSnapshot implements RemoteSnapshot {
  async load(workspaceId: string): Promise<Map<string, FileMeta>> {
    const filePath = this.filePath(workspaceId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, FileMeta>;
      return new Map<string, FileMeta>(Object.entries(obj));
    } catch {
      return new Map();
    }
  }

  async save(workspaceId: string, data: Map<string, FileMeta>): Promise<void> {
    const filePath = this.filePath(workspaceId);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const obj = Object.fromEntries(data.entries());
    await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
  }

  private filePath(workspaceId: string): string {
    return path.join(workspaceId, '.livesync', 'remote-index.json');
  }
}
