import { createHash } from 'crypto';
import type { FolderMeta, NodeIndex, NodeMeta, RelPath } from '@domain/types';
import { stringToRel } from '../path';

/**
 * Compute deterministic Merkle-style folder hash.
 * - Only counts FILE descendants (not subfolders)
 * - Format: "file relPath hash" lines, sorted lexicographically
 * - Empty folder => hash of empty string
 */
export function computeFolderHashFromNodeIndex(index: NodeIndex, folderRel: RelPath): string {
  const base = folderRel as string;
  const prefix = base ? `${base}/` : '';
  const lines: string[] = [];

  // Collect all descendant FILES
  for (const [rel, meta] of index) {
    if (meta.type !== 'file') {continue;}
    
    const s = rel as string;
    const isUnder = !base || s === base || (prefix && s.startsWith(prefix));
    
    if (isUnder) {
      const name = prefix ? s.slice(prefix.length) : s;
      const h = (meta as NodeMeta & { hash?: string }).hash ?? '__unknown__';
      lines.push(`file ${name} ${h}`);
    }
  }

  lines.sort((a, b) => a.localeCompare(b));
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Compute hashes for all folders in the index, bottom-up.
 */
export async function computeAllFolderHashes(index: Map<RelPath, NodeMeta>): Promise<void> {
  const folders = Array.from(index.entries())
    .filter(([, meta]) => meta.type === 'folder')
    .map(([rel]) => rel)
    .sort((a, b) => {
      const depthA = (a as string).split('/').filter(Boolean).length;
      const depthB = (b as string).split('/').filter(Boolean).length;
      return depthB - depthA;
    });

  for (const folderRel of folders) {
    const hash = computeFolderHashFromNodeIndex(index, folderRel);
    const folderMeta = index.get(folderRel);
    if (folderMeta && folderMeta.type === 'folder') {
      folderMeta.hash = hash;
    }
  }

  const rootHash = computeFolderHashFromNodeIndex(index, stringToRel(''));
  index.set(stringToRel(''), { type: 'folder', hash: rootHash } as FolderMeta);
}