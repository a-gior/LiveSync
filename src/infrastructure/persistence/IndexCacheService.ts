import * as fs from 'fs/promises';
import * as path from 'path';
import type { WorkspaceId, NodeIndex, FileMeta } from '../../domain/types';
import { stringToRel, wsToString } from '../helpers/path';

type Cache = {
  version: 1;
  timestamp: number;
  entries: Record<string, FileMeta>;
};

export class IndexCacheService {
  constructor(private readonly fileName: 'index.local.json' | 'index.remote.json') {}

  private filePath(workspaceFsPath: string): string {
    return path.join(workspaceFsPath, '.livesync', this.fileName);
  }

  async load(workspaceId: WorkspaceId): Promise<NodeIndex | undefined> {
    try {
      const raw = await fs.readFile(this.filePath(wsToString(workspaceId)), 'utf8');
      const data = JSON.parse(raw) as Cache;
      if (data.version !== 1 || !data.entries) { return undefined; }
      const map: NodeIndex = new Map();
      for (const [k, v] of Object.entries(data.entries)) {
        const rel = stringToRel( k.replace(/\\/g, '/'));
        map.set(rel, v);
      }
      return map;
    } catch { return undefined; }
  }

  async save(workspaceId: WorkspaceId, index: NodeIndex): Promise<void> {
    const fp = this.filePath(workspaceId);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    const obj: Cache = {
      version: 1,
      timestamp: Date.now(),
      entries: Object.fromEntries(index.entries()) as any
    };
    await fs.writeFile(fp, JSON.stringify(obj, null, 2), 'utf8');
  }
}
