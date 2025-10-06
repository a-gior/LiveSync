import { DiffEntry, FileMeta, NodeType } from '@domain/types';

export interface DiffEngine {
  computeFull(
    localIndex: Map<string, FileMeta>,
    remoteIndex: Map<string, FileMeta>
  ): Map<string, DiffEntry>;

  /**
   * Same as computeFull, but also adds synthetic folder entries with aggregated status.
   * Folder existence is inferred from children (no empty-dir tracking yet).
   */
  computeWithFolders?(
    localIndex: Map<string, FileMeta>,
    remoteIndex: Map<string, FileMeta>
  ): Map<string, DiffEntry>;
}

export class DefaultDiffEngine implements DiffEngine {
  computeFull(localIndex: Map<string, FileMeta>, remoteIndex: Map<string, FileMeta>): Map<string, DiffEntry> {
    const diffMap = new Map<string, DiffEntry>();
    const allPaths = new Set<string>([...localIndex.keys(), ...remoteIndex.keys()]);

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
        const typeChanged = localMeta!.type !== remoteMeta!.type;

        let contentChanged = false;
        if (!typeChanged) {
          const localHash = localMeta!.hash;
          const remoteHash = remoteMeta!.hash;

          if (localHash !== undefined && remoteHash !== undefined) {
            contentChanged = localHash !== remoteHash;
          } else {
            contentChanged = true;
          }
        }

        status = (typeChanged || contentChanged) ? 'modified' : 'unchanged';
      }

      diffMap.set(path, { path, type: combinedType, status, left: localMeta, right: remoteMeta });
    }

    return diffMap;
  }

  computeWithFolders(
    localIndex: Map<string, FileMeta>,
    remoteIndex: Map<string, FileMeta>
  ): Map<string, DiffEntry> {
    const leafDiff = this.computeFull(localIndex, remoteIndex);

    // 1) collect all folder paths from both indexes
    const folderPaths = new Set<string>();
    const addParents = (filePath: string): void => {
      const segments = filePath.split('/');
      let prefix = '';
      for (let i = 0; i < segments.length - 1; i += 1) {
        prefix = prefix ? `${prefix}/${segments[i]}` : segments[i];
        folderPaths.add(prefix);
      }
    };
    for (const path of localIndex.keys()) {
      if (path.includes('/')) { addParents(path); }
    }
    for (const path of remoteIndex.keys()) {
      if (path.includes('/')) { addParents(path); }
    }

    // 2) derive existence on each side purely from descendants
    const localHasDescendants = buildPrefixIndex(localIndex);
    const remoteHasDescendants = buildPrefixIndex(remoteIndex);

    // 3) aggregate status per folder
    for (const folderPath of folderPaths) {
      const existsLocal = localHasDescendants.has(folderPath);
      const existsRemote = remoteHasDescendants.has(folderPath);

      let status: DiffEntry['status'];
      if (existsLocal && !existsRemote) {
        status = 'added';
      } else if (!existsLocal && existsRemote) {
        status = 'removed';
      } else if (existsLocal && existsRemote) {
        // modified if any descendant under this folder is not unchanged
        const hasChange = anyChangeUnder(leafDiff, folderPath);
        status = hasChange ? 'modified' : 'unchanged';
      } else {
        // No descendants on either side; skip emitting a meaningless folder.
        continue;
      }

      leafDiff.set(folderPath, {
        path: folderPath,
        type: 'folder',
        status,
        left: existsLocal ? { type: 'folder' } : undefined,
        right: existsRemote ? { type: 'folder' } : undefined
      });
    }

    // 4) handle type-change (file↔folder) edge-case if present in indexes:
    // If a file exists at "a" on one side and "a/..." exists on the other, mark "a" as modified.
    for (const path of leafDiff.keys()) {
      // Only consider non-folder entries that are files.
      const entry = leafDiff.get(path)!;
      if (entry.type !== 'file') {
        continue;
      }
      // If there are descendants "path/..." on the other side, flip this entry to modified.
      const hasLocalDesc = localHasDescendants.has(path);
      const hasRemoteDesc = remoteHasDescendants.has(path);
      if ((hasLocalDesc || hasRemoteDesc)) {
        entry.status = 'modified';
      }
    }

    return leafDiff;
  }
}

/** Build a set of all folder prefixes that have at least one descendant. */
function buildPrefixIndex(index: Map<string, FileMeta>): Set<string> {
  const set = new Set<string>();
  for (const filePath of index.keys()) {
    const segments = filePath.split('/');
    let prefix = '';
    for (let i = 0; i < segments.length - 1; i += 1) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i];
      set.add(prefix);
    }
  }
  return set;
}

/** True if any descendant diff under folderPath has status != 'unchanged'. */
function anyChangeUnder(diff: Map<string, DiffEntry>, folderPath: string): boolean {
  const prefix = `${folderPath}/`;
  for (const [path, entry] of diff) {
    if (path.startsWith(prefix) && entry.status !== 'unchanged') {
      return true;
    }
  }
  return false;
}
