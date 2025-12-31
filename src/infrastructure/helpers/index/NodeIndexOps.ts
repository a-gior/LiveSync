import type { NodeIndex, NodeMeta, RelPath } from '@domain/types';
import { stringToRel } from '../path';

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

/**
 * Rename a path and all its descendants in a NodeIndex.
 */
export function renameSubtree(
  index: NodeIndex,
  oldPath: RelPath,
  newPath: RelPath,
  ensureAncestors?: (index: NodeIndex, path: RelPath, meta: NodeMeta) => void
): void {
  const descendants: Array<[RelPath, NodeMeta]> = [];
  const oldPathStr = oldPath as string;
  const prefix = oldPathStr.endsWith('/') ? oldPathStr : `${oldPathStr}/`;
  
  for (const [path, meta] of index) {
    const pathStr = path as string;
    if (pathStr === oldPathStr || pathStr.startsWith(prefix)) {
      descendants.push([path, meta]);
    }
  }
  
  deleteSubtree(index, oldPath, true);
  
  const newPathStr = newPath as string;
  for (const [oldDescendantPath, meta] of descendants) {
    const oldStr = oldDescendantPath as string;
    const newStr = oldStr === oldPathStr 
      ? newPathStr 
      : (newPathStr.endsWith('/') ? newPathStr : `${newPathStr}/`) + oldStr.slice(prefix.length);
    
    const newDescendantPath = stringToRel(newStr);
    
    if (ensureAncestors) {
      ensureAncestors(index, newDescendantPath, meta);
    }
    
    index.set(newDescendantPath, meta);
  }
}