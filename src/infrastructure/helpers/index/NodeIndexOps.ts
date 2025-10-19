import type { NodeIndex, RelPath } from '@domain/types';

/** Remove every entry at root and below; includeRoot controls whether root itself is removed. */
export function deleteSubtree(index: NodeIndex, root: RelPath, includeRoot: boolean): void {
  const toDelete: RelPath[] = [];
  const rootStr = root as string;
  const prefix = rootStr.length ? `${rootStr}/` : '';

  for (const key of index.keys()) {
    const s = key as string;
    if (s === rootStr && includeRoot) {
      toDelete.push(key);
    } else if (prefix && s.startsWith(prefix)) {
      toDelete.push(key);
    }
  }
  for (const p of toDelete) {
    index.delete(p);
  }
}
