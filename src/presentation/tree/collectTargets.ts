import type { DiffEntry } from '../../domain/types';

/** Returns file paths under folderPath (inclusive) that pass the predicate. */
export function collectTargetsRecursive(
  diff: Map<string, DiffEntry>,
  folderPath: string | undefined,
  predicate: (e: DiffEntry) => boolean
): string[] {
  const targets: string[] = [];
  const prefix = folderPath ? folderPath.replace(/\/+$/, '') + '/' : '';
  for (const [p, e] of diff.entries()) {
    const inScope = folderPath ? (p === folderPath || p.startsWith(prefix)) : true;
    if (inScope && e.type === 'file' && predicate(e)) {
      targets.push(p);
    }
  }
  return targets;
}
