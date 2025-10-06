export type NodeType = 'file' | 'folder';
export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged' | 'conflict';

/**
 * FileMeta describes a node on one side (local or remote).
 * - For files: `hash` is the content hash.
 * - For folders: `hash` is a directory/merkle hash computed elsewhere (not here).
 */
export interface FileMeta {
  type: NodeType;
  hash?: string; // if absent, we can't prove equality → we’ll treat as modified when compared
}

export interface DiffEntry {
  path: string;       // normalized relative path (posix-style)
  type: NodeType;
  status: DiffStatus; // added/removed/modified/unchanged (conflict reserved for later)
  left?: FileMeta;    // local
  right?: FileMeta;   // remote
}
