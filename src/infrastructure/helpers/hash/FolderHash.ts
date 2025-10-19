import { createHash } from 'crypto';
import type { NodeIndex, NodeMeta, RelPath } from '@domain/types';

const UNKNOWN = '__unknown__';

/**
 * Compute a stable folder hash from descendant file hashes.
 * For folder F, we hash the sorted list of "rel-from-F:childHash".
 * Empty folder => sha1('') to keep determinism.
 */
export function computeFolderHashFromFiles(
  folder: RelPath,
  fileHashes: Map<RelPath, string>
): string {
  const base = (folder as unknown as string).replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = base ? base + '/' : '';

  // Collect all descendant files of `folder`
  const items: string[] = [];
  for (const [file, h] of fileHashes) {
    const s = (file as unknown as string).replace(/\\/g, '/');
    if (s === base || (prefix && s.startsWith(prefix))) {
      // path relative to folder
      const rel = prefix ? s.slice(prefix.length) : s;
      items.push(`${rel}:${h}`);
    }
  }
  items.sort();

  const hash = createHash('sha1');
  for (const line of items) {
    hash.update(line);
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * Deterministic Merkle-like hash for a folder using all descendant *files* under `folderRel`.
 * - Stable across platforms: POSIX separators; lexicographic sort.
 * - Includes files with unknown/missing hashes using a placeholder.
 * - Ignores folder entries; only file lines participate.
 */
export function computeFolderHashFromNodeIndex(index: NodeIndex, folderRel: RelPath): string {
  const base = folderRel as string;
  const prefix = base ? `${base}/` : '';
  const lines: string[] = [];

  for (const [rel, meta] of index) {
    if (meta.type !== 'file') { continue; }
    const s = rel as string;
    if (s === base || (prefix && s.startsWith(prefix))) {
      const name = prefix ? s.slice(prefix.length) : s;
      const h = (meta as NodeMeta & { hash?: string }).hash ?? UNKNOWN;
      lines.push(`file ${name} ${h}`);
    }
  }

  lines.sort((a, b) => a.localeCompare(b));
  return createHash('sha1').update(lines.join('\n')).digest('hex');
}
