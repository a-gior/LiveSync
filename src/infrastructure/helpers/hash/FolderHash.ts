import { createHash } from 'crypto';
import type { NodeIndex, NodeMeta, RelPath } from '@domain/types';

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
    if (meta.type !== 'file') continue;
    
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