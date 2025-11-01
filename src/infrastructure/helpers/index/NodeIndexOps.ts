import type { NodeIndex, NodeMeta, RelPath, WorkspaceId } from '@domain/types';
import { stringToRel } from '../path';
import { absFs } from '../path/PathJoin';
import { sha256OfFile } from '../hash/FileHash';
import type { RemotePort } from '@app/ports/RemotePort';
import type { SyncStateManager } from '@app/SyncStateManager';
import * as fsp from 'fs/promises';
import * as path from 'path';

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

/**
 * Restore a folder (and its descendants) from remote to local.
 * Returns the number of files restored.
 * - Uses remote.list(workspace) once and downloads only file nodes under the prefix.
 * - Updates *local* snapshot only; the remote snapshot is already authoritative.
 */
export async function restoreRemoteSubtree(
  workspaceId: WorkspaceId,
  folderRel: RelPath,
  remote: RemotePort,
  state: SyncStateManager
): Promise<number> {
  const remoteIndex: NodeIndex = await remote.list(workspaceId);
  state.setRemoteIndex(workspaceId, remoteIndex);

  const normalized = (folderRel as string).replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = normalized ? normalized + '/' : '';
  const targets: RelPath[] = [];

  const exact = remoteIndex.get(stringToRel(normalized));
  if (exact?.type === 'file') {
    targets.push(stringToRel(normalized));
  } else {
    for (const [rel, meta] of remoteIndex) {
      const s = rel as string;
      if (rel === stringToRel(normalized) || (prefix && s.startsWith(prefix))) {
        if (meta.type === 'file') {targets.push(rel);}
        // For folders: we'll ensure directories exist locally before downloading files
      }
    }
  }

  if (targets.length === 0) {return 0;}

  let restored = 0;
  for (const rel of targets) {
    const absLocal = absFs(workspaceId, rel);
    await fsp.mkdir(path.dirname(absLocal), { recursive: true });
    await remote.downloadFile(workspaceId, rel, absLocal);
    const hash = await sha256OfFile(absLocal);
    state.applyLocal({ workspaceId, type: 'modify', path: rel, meta: { type: 'file', hash } });
    restored += 1;
  }
  return restored;
}