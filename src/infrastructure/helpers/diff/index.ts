import type { DiffMap, DiffStatus, RelPath } from '@domain/types';
import { isUnder as isUnderPath } from '@infra/helpers/path';

/** Uploadable statuses: added | modified | conflict */
export function isUploadable(status: DiffStatus): boolean {
  return status === 'added' || status === 'modified' || status === 'unchanged' || status === 'conflict';
}
/** Deletable statuses: removed */
export function isDeletable(status: DiffStatus): boolean {
  return status === 'removed';
}

export function isDownloadable(status: DiffStatus): boolean {
  // We can *pull* when the file is missing locally (removed),
  // or differs (modified/conflict).
  return status === 'removed' || status === 'modified' || status === 'unchanged' || status === 'conflict';
}

export function isResolvable(status: DiffStatus): boolean {
  return status === 'modified' || status === 'conflict';
}

/** Returns all rel paths that are `root` or under `root/…` */
export function collectUnder(diff: DiffMap, root: RelPath): RelPath[] {
  const out: RelPath[] = [];
  for (const p of diff.keys()) {
    if (isUnderPath(root, p)) {
      out.push(p);
    }
  }
  return out;
}

/** Split changes under `root` into uploadable files, deletable files, and removed dirs. */
export function partitionChangesUnder(
  diff: DiffMap,
  root: RelPath
): { toUploadFiles: RelPath[]; toDeleteFiles: RelPath[]; removedDirs: RelPath[] } {
  const toUploadFiles: RelPath[] = [];
  const toDeleteFiles: RelPath[] = [];
  const removedDirs: RelPath[] = [];

  for (const [p, e] of diff.entries()) {
    if (!isUnderPath(root, p)) { continue; }

    if (e.type === 'file') {
      if (isUploadable(e.status)) {
        toUploadFiles.push(p);
      } else if (isDeletable(e.status)) {
        toDeleteFiles.push(p);
      }
    } else if (e.type === 'folder' && e.status === 'removed') {
      removedDirs.push(p);
    }
  }

  return { toUploadFiles, toDeleteFiles, removedDirs };
}

/** Keep only top-most directories (remove children of any kept dir). */
export function topMost(dirs: readonly RelPath[]): RelPath[] {
  const sorted = [...dirs].sort(
    (a, b) => (a as unknown as string).length - (b as unknown as string).length
  );
  const out: RelPath[] = [];
  for (const d of sorted) {
    const ds = d as unknown as string;
    if (!out.some((top) => (ds + '/').startsWith((top as unknown as string) + '/'))) {
      out.push(d);
    }
  }
  return out;
}
