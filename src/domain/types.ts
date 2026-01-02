// src/domain/types.ts

export type NodeType = 'file' | 'folder';
export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged' | 'conflict';
export type ConflictKind =
  | 'type'               // file ↔ folder mismatch
  | 'content';            // remote side edited by someone else

// Branded relative path & workspace id (for safer APIs)
export type RelPath = string & { __brand_relpath: true };
export type WorkspaceId = string & { __brand_ws: true }; // folder.uri.fsPath

/**
 * FileMeta: file node on one side (local or remote).
 * - hash is the file *content* hash.
 */
export interface FileMeta {
  type: 'file';
  hash: string;          // required for deterministic diff
  size?: number;
  mtimeMs?: number;
}

/**
 * FolderMeta: folder node (including empty folders).
 * - hash is a Merkle-style hash of direct children (files & folders), computed elsewhere.
 *   If you don’t have it yet, use a sentinel like '__unknown__' and treat as modified.
 */
export interface FolderMeta {
  type: 'folder';
  hash: string;          // required; if unknown use a sentinel (e.g. '__unknown__')
  childCount?: number;   // optional: useful for UI/tests
}

export type NodeMeta = FileMeta | FolderMeta;

/**
 * Diff entry for a path present on either/both sides.
 * - left: local side meta (if present)
 * - right: remote side meta (if present)
 */
export interface DiffEntry {
  path: RelPath;         // normalized posix-style relative path
  type: NodeType;        // 'file' | 'folder' (type-change is detected when left/right types differ)
  status: DiffStatus;    // added/removed/modified/unchanged (conflict reserved for later)
  left?: NodeMeta;       // local side
  right?: NodeMeta;      // remote side
}

/** Unified node index (files + folders). */
export type NodeIndex = Map<RelPath, NodeMeta>;
export type ReadonlyNodeIndex = ReadonlyMap<RelPath, NodeMeta>;

export type DiffMap = Map<RelPath, DiffEntry>;
export type ReadonlyDiffMap = ReadonlyMap<RelPath, DiffEntry>;

/** Per-workspace containers */
export type PerWorkspace<T> = Map<WorkspaceId, T>;
export type PerWorkspaceNodeIndex = PerWorkspace<NodeIndex>;

/** Type guards (handy in engine/indexers) */
export const isFileMeta = (m: NodeMeta): m is FileMeta => m.type === 'file';
export const isFolderMeta = (m: NodeMeta): m is FolderMeta => m.type === 'folder';

export type ActionPolicy = {
  check: boolean;
  direction?: 'upload' | 'download';
  extras: Set<'delete' | 'move'>;
};