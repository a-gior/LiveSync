import {
  DiffEntry,
  DiffMap,
  NodeMeta,
  NodeType,
  RelPath,
  ReadonlyNodeIndex,
} from '@domain/types';

/**
 * DiffEngine - Simple 2-Way Diff Calculator
 * 
 * Compares two snapshots to determine file status:
 * 
 * - local: Actual current state of local files/folders
 * - remote: Actual current state of remote files/folders (updated on checks/refreshes)
 * - base: Last known sync baseline (NOT used for status, only for conflict detection)
 * 
 * Status determination is purely 2-way (local vs remote):
 * - "added": Local has file, remote doesn't → need to upload
 * - "removed": Remote has file, local doesn't → need to download
 * - "modified": Both have file but different content → need to review/sync
 * - "unchanged": Both have same content → no action needed
 * 
 * The base snapshot is passed in but NOT used for status determination.
 * It's ONLY used for conflict detection in the conflict detector module.
 */
export interface DiffEngine {
  compute(local: ReadonlyNodeIndex, remote: ReadonlyNodeIndex, base: ReadonlyNodeIndex): DiffMap;
}

export class DefaultDiffEngine implements DiffEngine {
  compute(local: ReadonlyNodeIndex, remote: ReadonlyNodeIndex, base: ReadonlyNodeIndex): DiffMap {
    const diff: DiffMap = new Map<RelPath, DiffEntry>();

    // Get all paths from local and remote
    // (base paths included for completeness, but won't generate entries if both local/remote are empty)
    const allPaths = new Set<RelPath>([...local.keys(), ...remote.keys(), ...base.keys()]);

    for (const path of allPaths) {
      const localMeta  = local.get(path);
      const remoteMeta = remote.get(path);

      const entry = this.computeEntryStatus(localMeta, remoteMeta, path);
      if (entry) {
        diff.set(path, entry);
      }
    }

    return diff;
  }

  /**
   * Compute diff entry status using simple 2-way comparison
   * 
   * Pure comparison of local vs remote state.
   * Base is NOT used here - conflict detection happens separately.
   * 
   * @param local - Current local state
   * @param remote - Current remote state
   * @param path - File path
   * @returns DiffEntry or null if file doesn't exist on either side
   */
  private computeEntryStatus(
    local?: NodeMeta,
    remote?: NodeMeta,
    path?: RelPath
  ): DiffEntry | null {
    // If neither exists, nothing to show in diff
    if (!local && !remote) {
      return null;
    }

    // Type mismatch (file vs folder) - always a conflict
    if (local && remote && local.type !== remote.type) {
      return {
        path: path!,
        type: local.type,
        status: 'conflict',
        left: local,
        right: remote
      };
    }

    const type: NodeType = (local?.type ?? remote?.type ?? 'file');

    // ========================================================================
    // Simple 2-way comparison: local vs remote
    // ========================================================================

    // Both exist - compare content
    if (local && remote) {
      if (this.hashesEqual(local.hash, remote.hash)) {
        return {
          path: path!,
          type,
          status: 'unchanged',
          left: local,
          right: remote
        };
      } else {
        return {
          path: path!,
          type,
          status: 'modified',
          left: local,
          right: remote
        };
      }
    }

    // Only local exists - need to upload
    if (local && !remote) {
      return {
        path: path!,
        type: local.type,
        status: 'added',
        left: local,
        right: undefined
      };
    }

    // Only remote exists - need to download
    if (!local && remote) {
      return {
        path: path!,
        type: remote.type,
        status: 'removed',
        left: undefined,
        right: remote
      };
    }

    // Shouldn't reach here
    return null;
  }

  /**
   * Compare two hashes for equality
   * Treats unknown hashes as not equal
   */
  private hashesEqual(a?: string, b?: string): boolean {
    if (!a || !b) { return false; }
    if (a === '__unknown__' || b === '__unknown__') { return false; }
    return a === b;
  }
}