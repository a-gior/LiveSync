import { DiffEntry, FileMeta, NodeType } from '../types';

export interface DiffEngine {
  computeFull(
    localIndex: Map<string, FileMeta>,
    remoteIndex: Map<string, FileMeta>
  ): Map<string, DiffEntry>;
}

/**
 * Hash-only diff engine.
 * Rules:
 * - Exists only locally  -> added
 * - Exists only remotely -> removed
 * - Both exist:
 *    - type differs                -> modified
 *    - both hashes present & equal -> unchanged
 *    - hashes differ or missing    -> modified
 */
export class DefaultDiffEngine implements DiffEngine {
  computeFull(
    localIndex: Map<string, FileMeta>,
    remoteIndex: Map<string, FileMeta>
  ): Map<string, DiffEntry> {
    const diffMap = new Map<string, DiffEntry>();
    const allPaths = new Set<string>([
      ...localIndex.keys(),
      ...remoteIndex.keys()
    ]);

    for (const path of allPaths) {
      const localMeta = localIndex.get(path);
      const remoteMeta = remoteIndex.get(path);

      if (!localMeta && !remoteMeta) {
        continue;
      }

      const combinedType: NodeType = (localMeta?.type ?? remoteMeta!.type);
      let status: DiffEntry['status'] = 'unchanged';

      if (localMeta && !remoteMeta) {
        status = 'added';
      } else if (!localMeta && remoteMeta) {
        status = 'removed';
      } else {
        // Both exist
        const typeChanged = localMeta!.type !== remoteMeta!.type;

        let contentChanged = false;
        if (!typeChanged) {
          const localHash = localMeta!.hash;
          const remoteHash = remoteMeta!.hash;

          if (localHash !== undefined && remoteHash !== undefined) {
            contentChanged = localHash !== remoteHash;
          } else {
            // Missing hash on either side → conservative choice
            contentChanged = true;
          }
        }

        status = (typeChanged || contentChanged) ? 'modified' : 'unchanged';
      }

      diffMap.set(path, {
        path,
        type: combinedType,
        status,
        left: localMeta,
        right: remoteMeta
      });
    }

    return diffMap;
  }
}
