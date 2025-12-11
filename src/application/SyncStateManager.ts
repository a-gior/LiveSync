import {
  DiffEntry,
  DiffMap,
  NodeIndex,
  NodeMeta,
  RelPath,
  WorkspaceId,
  ReadonlyNodeIndex,
} from '@domain/types';
import { DiffEngine } from '@domain/diff/DiffEngine';

import { dirnameRel, parentsOf, stringToRel } from '@helpers/path';
import { computeFolderHashFromNodeIndex } from '@helpers/hash';
import { deleteSubtree, renameSubtree } from '@helpers/index';

/** FS event kinds we reflect into the snapshot. */
export type EventType  = 'create' | 'modify' | 'delete' | 'rename';

type DiffChangeEvent = {
  workspaceId: WorkspaceId;
  /** Used by the TreeView to refresh only a branch (parent of changedPath). */
  parentPath?: RelPath;
  /** The path that triggered the recompute (for targeted refresh). */
  changedPath?: RelPath;
};

type DiffListener = (event: DiffChangeEvent) => void;


export type ConflictType = 'remote-modified' | 'local-modified';

export type ConflictEvent = {
  workspaceId: WorkspaceId;
  relPath: RelPath;
  type: ConflictType;
  reason: string;
};

type ConflictChangeEvent = {
  type: 'added' | 'removed' | 'cleared';
  conflict?: ConflictEvent; // Present for 'added', undefined for 'removed'/'cleared'
  workspaceId?: WorkspaceId; // Present for 'cleared'
};

type ConflictListener = (event: ConflictChangeEvent) => void;

/**
 * Framework-agnostic state manager.
 * - Holds per-workspace local/remote NodeIndex snapshots and the computed DiffMap.
 * - Emits targeted change events whenever a recompute happens.
 * - Provides optimistic mutation helpers for the *remote* snapshot so the UI updates instantly
 *   after we perform a remote action (upload/delete/rename), without a full rescan.
 */
export class SyncStateManager {
  // Per-workspace snapshots (files + folders, with hashes)
  private localByWorkspace: Map<WorkspaceId, NodeIndex> = new Map();
  private remoteByWorkspace: Map<WorkspaceId, NodeIndex> = new Map();

  // Computed diffs per workspace
  private diffByWorkspace: Map<WorkspaceId, DiffMap> = new Map();

  // Workspaces currently batching: recompute is deferred until batch ends
  private batchingWorkspaces: Set<WorkspaceId> = new Set();

  private diffListeners = new Set<DiffListener>();

  private ignoredConflicts = new Map<string, ConflictEvent>(); // key: workspaceId:relPath
  private conflictListeners = new Set<ConflictListener>();

  constructor(private readonly diffEngine: DiffEngine) {}

  // ------------------------------------------------------------------------------------
  // Subscriptions
  // ------------------------------------------------------------------------------------

  subscribeToDiffChanges(listener: DiffListener): () => void {
    this.diffListeners.add(listener);
    return () => { this.diffListeners.delete(listener); };
  }

  // ------------------------------------------------------------------------------------
  // Snapshot setters (replace entire index)
  // ------------------------------------------------------------------------------------

  setLocalIndex(workspaceId: WorkspaceId, index: NodeIndex): void {
    this.localByWorkspace.set(workspaceId, new Map(index));
    this.recompute(workspaceId);
  }

  setRemoteIndex(workspaceId: WorkspaceId, index: NodeIndex): void {
    this.remoteByWorkspace.set(workspaceId, new Map(index));
    this.recompute(workspaceId);
  }

  // ------------------------------------------------------------------------------------
  // Incremental *local* mutations (from FS events): create/modify/delete/rename
  // These update the local snapshot and trigger a recompute.
  // meta: NodeMeta for 'file' (with content hash) or 'folder' (with folder hash)
  // ------------------------------------------------------------------------------------

  applyLocal(event: {
    workspaceId: WorkspaceId;
    type: EventType;
    path: RelPath;
    meta?: NodeMeta;
    newPath?: RelPath;
  }): void {
    const local = this.ensureWorkspaceIndex(this.localByWorkspace, event.workspaceId);

    switch (event.type) {
      case 'create':
      case 'modify': {
        if (!event.meta) { return; }
        if (event.meta.type === 'file') { this.ensureAncestorFolders(local, event.path); }
        local.set(event.path, event.meta);
        this.rehashAncestors(local, event.path);
        break;
      }
      case 'delete': {
        deleteSubtree(local, event.path, /*includeRoot*/ true);
        break;
      }
      case 'rename': {
        if (event.newPath) {
          renameSubtree(local, event.path, event.newPath, (index, path, meta) => {
            if (meta.type === 'file') {
              this.ensureAncestorFolders(index, path);
            }
          });
        }
        break;
      }
      default: {
        // no-op
        break;
      }
    }

    const hint = stringToRel(event.newPath ?? event.path);
    this.recompute(event.workspaceId, hint);
  }

  /**
   * Apply an incremental change to the remote snapshot.
   */
  applyRemote(event: {
    workspaceId: WorkspaceId;
    type: EventType;
    path: RelPath;
    meta?: NodeMeta;
    newPath?: RelPath;
  }): void {
    const remote = this.ensureWorkspaceIndex(this.remoteByWorkspace, event.workspaceId);

    switch (event.type) {
      case 'create':
      case 'modify': {
        if (!event.meta) { return; }
        if (event.meta.type === 'file') { 
          this.ensureAncestorFolders(remote, event.path); 
        }
        remote.set(event.path, event.meta);
        this.rehashAncestors(remote, event.path);
        break;
      }
      case 'delete': {
        deleteSubtree(remote, event.path, /*includeRoot*/ true);
        this.rehashAncestors(remote, event.path);
        break;
      }
      case 'rename': {
        if (event.newPath) {
          renameSubtree(remote, event.path, event.newPath, (index, path, meta) => {
            if (meta.type === 'file') {
              this.ensureAncestorFolders(index, path);
            }
          });
          this.rehashAncestors(remote, event.newPath);
        }
        break;
      }
    }

    const hint = stringToRel(event.newPath ?? event.path);
    this.recompute(event.workspaceId, hint);
  }

  // ------------------------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------------------------

  getDiffEntry(workspaceId: WorkspaceId, path: RelPath): DiffEntry | undefined {
    const diff = this.ensureWorkspaceDiff(this.diffByWorkspace, workspaceId);
    return diff.get(path);
  }

  /**
   * Return immediate children under a parent path according to the current diff.
   * - If parentPath is undefined or '', returns top-level entries.
   * - Returns deduplicated child paths (files or folders) as RelPath[] sorted lexicographically.
   */
  getChildren(workspaceId: WorkspaceId, parentPath?: RelPath): RelPath[] {
    const prefix = parentPath && (parentPath as string).length > 0
      ? (stringToRel(parentPath + '/'))
      : (stringToRel(''));

    const diff = this.ensureWorkspaceDiff(this.diffByWorkspace, workspaceId);
    const childPaths = new Set<RelPath>();

    for (const fullPath of diff.keys()) {
      const s = fullPath as string;
      if (prefix && !s.startsWith(prefix)) { continue; }
      const remainder = prefix ? s.slice((prefix as string).length) : s;
      if (!remainder) { continue; }
      const firstSegment = remainder.split('/')[0];
      if (firstSegment) {
        childPaths.add(stringToRel((prefix as string) + firstSegment));
      }
    }

    return Array.from(childPaths).sort((a, b) => (a as string).localeCompare(b as string));
  }

  /** Shallow read-only copies for external consumers (avoid leaking internal maps). */
  public getLocalIndex(workspaceId: WorkspaceId): ReadonlyNodeIndex {
    const idx = this.ensureWorkspaceIndex(this.localByWorkspace, workspaceId);
    return new Map(idx);
  }

  public getRemoteIndex(workspaceId: WorkspaceId): ReadonlyNodeIndex {
    const idx = this.ensureWorkspaceIndex(this.remoteByWorkspace, workspaceId);
    return new Map(idx);
  }

  public getLocalMeta(workspaceId: WorkspaceId, path: RelPath): NodeMeta | undefined {
    return this.ensureWorkspaceIndex(this.localByWorkspace, workspaceId).get(path);
  }

  public getRemoteMeta(workspaceId: WorkspaceId, path: RelPath): NodeMeta | undefined {
    return this.ensureWorkspaceIndex(this.remoteByWorkspace, workspaceId).get(path);
  }

  /** Shallow copy of the whole diff map (read-only to callers). */
  public getDiffEntries(workspaceId: WorkspaceId): DiffMap {
    const diff = this.ensureWorkspaceDiff(this.diffByWorkspace, workspaceId);
    return new Map(diff);
  }

  // ------------------------------------------------------------------------------------
  // Batching
  // ------------------------------------------------------------------------------------

  /**
   * Batch a sequence of mutations (local and/or remote). We suppress recomputes during the
   * callback, then do a single recompute at the end with an optional hintPath for targeted refresh.
   */
  public runBatch(workspaceId: WorkspaceId, hintPath: RelPath | undefined, fn: () => void): void {
    this.batchingWorkspaces.add(workspaceId);
    try {
      fn();
    } finally {
      this.batchingWorkspaces.delete(workspaceId);
      this.recompute(workspaceId, hintPath);
    }
  }

  // ------------------------------------------------------------------------------------
  // Convenience helpers for local snapshot management
  // ------------------------------------------------------------------------------------

  /** True if local index has an exact entry at relPath (file or folder). */
  public hasLocalEntry(workspaceId: WorkspaceId, relPath: RelPath): boolean {
    const idx = this.localByWorkspace.get(workspaceId);
    return !!idx && idx.has(relPath);
  }

  /** True if local index has any entries under relPath/… (files or folders). */
  public hasLocalChildren(workspaceId: WorkspaceId, relPath: RelPath): boolean {
    const idx = this.localByWorkspace.get(workspaceId);
    if (!idx) { return false; }
    const prefix = ((relPath as string).endsWith('/') ? (relPath as string) : ((relPath as string) + '/'));
    for (const key of idx.keys()) {
      if ((key as string).startsWith(prefix)) { return true; }
    }
    return false;
  }

  /**
   * Remove every local entry at relPath and below (file or folder subtree).
   * Internally performs per-path deletes within a batch to emit a single targeted refresh.
   */
  public removeLocalSubtree(workspaceId: WorkspaceId, relPath: RelPath): void {
    const idx = this.localByWorkspace.get(workspaceId);
    if (!idx) { return; }

    const toDelete: RelPath[] = [];
    const rootStr = relPath as string;
    const prefix = rootStr.endsWith('/') ? rootStr : (rootStr + '/');

    if (idx.has(relPath)) { toDelete.push(relPath); }
    for (const key of idx.keys()) {
      const s = key as string;
      if (s.startsWith(prefix)) { toDelete.push(key); }
    }
    if (toDelete.length === 0) { return; }

    this.runBatch(workspaceId, relPath, () => {
      for (const p of toDelete) {
        this.applyLocal({ workspaceId, type: 'delete', path: p });
      }
    });
  }

  // ------------------------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------------------------

  /** Recompute the diff for one workspace (skips if in a batch). */
  private recompute(workspaceId: WorkspaceId, touchedPath?: RelPath): void {
    if (this.batchingWorkspaces.has(workspaceId)) { return; }

    const local  = this.ensureWorkspaceIndex(this.localByWorkspace, workspaceId);
    const remote = this.ensureWorkspaceIndex(this.remoteByWorkspace, workspaceId);

    const newDiff = this.diffEngine.compute(local, remote);
    this.diffByWorkspace.set(workspaceId, newDiff);

    const parentPath = touchedPath ? (dirnameRel(touchedPath) || undefined) : undefined;
    this.emitDiffChange({ workspaceId, parentPath, changedPath: touchedPath });
  }

  /** Get-or-create a NodeIndex for a workspace. */
  private ensureWorkspaceIndex(map: Map<WorkspaceId, NodeIndex>, workspaceId: WorkspaceId): NodeIndex {
    let idx = map.get(workspaceId);
    if (!idx) {
      idx = new Map();
      map.set(workspaceId, idx);
    }
    return idx;
  }

  /** Get-or-create a DiffMap for a workspace. */
  private ensureWorkspaceDiff(map: Map<WorkspaceId, DiffMap>, workspaceId: WorkspaceId): DiffMap {
    let diff = map.get(workspaceId);
    if (!diff) {
      diff = new Map();
      map.set(workspaceId, diff);
    }
    return diff;
  }

  private emitDiffChange(event: DiffChangeEvent): void {
    for (const listener of this.diffListeners) {
      listener(event);
    }
  }

  // ------------------------------------------------------------------------------------
  // Folder-hash maintenance (now uses @infra/hash to ensure parity)
  // ------------------------------------------------------------------------------------

  /** Ensure all ancestor folders exist as folder nodes so their hashes can be computed. */
  private ensureAncestorFolders(index: NodeIndex, path: RelPath): void {
    for (const dir of parentsOf(path)) {
      if (!index.has(dir)) {
        index.set(dir, { type: 'folder', hash: '' });
      }
    }
  }

  /** Recompute folder hashes up the ancestor chain of `path` (plus root). */
  private rehashAncestors(index: NodeIndex, path: RelPath): void {
    // Recompute for each ancestor (closest first or last—order doesn’t matter here)
    for (const dir of parentsOf(path)) {
      const h = computeFolderHashFromNodeIndex(index, dir);
      const existing = index.get(dir);
      if (existing && existing.type === 'folder') {
        existing.hash = h;
      } else {
        index.set(dir, { type: 'folder', hash: h });
      }
    }
    // Also rehash the root '' (treat workspace root as a folder entry if you want top-level parity)
    const rootDir = stringToRel('');
    const rootHash = computeFolderHashFromNodeIndex(index, rootDir);
    const rootExisting = index.get(rootDir);
    if (rootExisting && rootExisting.type === 'folder') {
      rootExisting.hash = rootHash;
    } else {
      index.set(rootDir, { type: 'folder', hash: rootHash });
    }
  }
  
  // ============================================================================
  // Conflict event subscription (add after diffChangeListeners methods)
  // ============================================================================

  /**
   * Subscribe to conflict changes (added/removed/cleared)
   * Returns unsubscribe function
   */
  subscribeToConflictChanges(listener: ConflictListener): () => void {
    this.conflictListeners.add(listener);
    return () => { this.conflictListeners.delete(listener); };
  }

  private emitConflictChange(event: ConflictChangeEvent): void {
    for (const listener of this.conflictListeners) {
      listener(event);
    }
  }

  // ============================================================================
  // Conflict tracking methods (replace existing conflict methods)
  // ============================================================================

  /**
   * Mark a file as having an ignored conflict
   * Emits 'added' event
   */
  markConflictIgnored(
    workspaceId: WorkspaceId,
    relPath: RelPath,
    type: ConflictType,
    reason: string
  ): void {
    const key = `${workspaceId}:${relPath}`;
    const conflict: ConflictEvent = { workspaceId, relPath, type, reason };
    
    this.ignoredConflicts.set(key, conflict);
    this.emitConflictChange({ type: 'added', conflict });
  }

  /**
   * Check if a file has an ignored conflict
   */
  isConflictIgnored(workspaceId: WorkspaceId, relPath: RelPath): boolean {
    const key = `${workspaceId}:${relPath}`;
    return this.ignoredConflicts.has(key);
  }

  /**
   * Get the conflict info for a file (if ignored)
   */
  getConflict(workspaceId: WorkspaceId, relPath: RelPath): ConflictEvent | undefined {
    const key = `${workspaceId}:${relPath}`;
    return this.ignoredConflicts.get(key);
  }

  /**
   * Clear ignored conflict flag for a file
   * Emits 'removed' event
   */
  clearIgnoredConflict(workspaceId: WorkspaceId, relPath: RelPath): void {
    const key = `${workspaceId}:${relPath}`;
    const conflict = this.ignoredConflicts.get(key);
    
    if (this.ignoredConflicts.delete(key) && conflict) {
      this.emitConflictChange({ type: 'removed', conflict });
    }
  }

  /**
   * Clear all ignored conflicts for a workspace
   * Emits 'cleared' event
   */
  clearWorkspaceIgnoredConflicts(workspaceId: WorkspaceId): void {
    let hasChanges = false;
    const keysToDelete: string[] = [];
    
    for (const key of this.ignoredConflicts.keys()) {
      if (key.startsWith(`${workspaceId}:`)) {
        keysToDelete.push(key);
        hasChanges = true;
      }
    }
    
    keysToDelete.forEach(k => this.ignoredConflicts.delete(k));
    
    if (hasChanges) {
      this.emitConflictChange({ type: 'cleared', workspaceId });
    }
  }

  /**
   * Get all ignored conflicts
   * Useful for status bar to rebuild state
   */
  getAllConflicts(): ConflictEvent[] {
    return Array.from(this.ignoredConflicts.values());
  }

  /**
   * Get count of ignored conflicts
   */
  getConflictCount(): number {
    return this.ignoredConflicts.size;
  }

  /**
   * Get conflicts for a specific workspace
   */
  getWorkspaceConflicts(workspaceId: WorkspaceId): ConflictEvent[] {
    const conflicts: ConflictEvent[] = [];
    for (const [key, conflict] of this.ignoredConflicts.entries()) {
      if (key.startsWith(`${workspaceId}:`)) {
        conflicts.push(conflict);
      }
    }
    return conflicts;
  }
}
