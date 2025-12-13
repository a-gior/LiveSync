import type { NodeIndex, RelPath, FileMeta, FolderMeta } from '../../../src/domain/types';
import { stringToRel } from '../../../src/infrastructure/helpers/path';

export class IndexBuilder {
  private entries: Map<RelPath, FileMeta | FolderMeta> = new Map();

  addFile(path: string, hash: string, size?: number, mtimeMs?: number): this {
    const meta: FileMeta = {
      type: 'file',
      hash,
      ...(size !== undefined && { size }),
      ...(mtimeMs !== undefined && { mtimeMs })
    };
    this.entries.set(stringToRel(path), meta);
    return this;
  }

  addFolder(path: string, hash: string = '', childCount?: number): this {
    const meta: FolderMeta = {
      type: 'folder',
      hash,
      ...(childCount !== undefined && { childCount })
    };
    this.entries.set(stringToRel(path), meta);
    return this;
  }

  build(): NodeIndex {
    return new Map(this.entries);
  }
}
