import {
  DiffEntry,
  DiffMap,
  NodeMeta,
  NodeType,
  RelPath,
  ReadonlyNodeIndex,
} from '@domain/types';

/**
 * DiffEngine compares local and remote NodeIndex and returns a DiffMap.
 * Rules:
 * - same presence + same type + equal hash  -> unchanged
 * - present only on local                  -> added
 * - present only on remote                 -> removed
 * - both present but type differs          -> conflict
 * - both present, same type, hash differs  -> modified
 */
export interface DiffEngine {
  compute(local: ReadonlyNodeIndex, remote: ReadonlyNodeIndex): DiffMap;
}

export class DefaultDiffEngine implements DiffEngine {
  compute(local: ReadonlyNodeIndex, remote: ReadonlyNodeIndex): DiffMap {
    const diff: DiffMap = new Map<RelPath, DiffEntry>();

    // Union of paths from both sides (files + folders are explicit in NodeIndex)
    const allPaths = new Set<RelPath>([...local.keys(), ...remote.keys()]);

    for (const path of allPaths) {
      const left  = local.get(path);
      const right = remote.get(path);
      if (!left && !right) { continue; } // defensive

      const type: NodeType = (left?.type ?? right!.type);
      let status: DiffEntry['status'];

      if (left && !right) {
        status = 'added';
      } else if (!left && right) {
        status = 'removed';
      } else if (left!.type !== right!.type) {
        // Explicit file↔folder mismatch
        status = 'conflict';
      } else {
        // Same type: compare hashes (files or folders). Missing/unknown => modified.
        const lhash = (left as NodeMeta & { hash?: string }).hash;
        const rhash = (right as NodeMeta & { hash?: string }).hash;
        status = hashesAreKnownAndEqual(lhash, rhash) ? 'unchanged' : 'modified';
      }

      diff.set(path, { path, type, status, left, right });
    }

    return diff;
  }
}

/** Equal only if both hashes are present, not "__unknown__", and identical. */
function hashesAreKnownAndEqual(a?: string, b?: string): boolean {
  if (!a || !b) { return false; }
  if (a === '__unknown__' || b === '__unknown__') { return false; }
  return a === b;
}
