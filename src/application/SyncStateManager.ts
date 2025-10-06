import { DiffEntry, FileMeta } from '../domain/types';
import { DiffEngine } from '../domain/diff/DiffEngine';

export type LocalEventType = 'create' | 'modify' | 'delete' | 'rename';
export type RemoteEventType = 'create' | 'modify' | 'delete' | 'rename';

export type DiffChangeEvent = {
  workspaceId: string;
  parentPath?: string; // used by the TreeView to refresh only a branch
  changedPath?: string;
};

type Listener = (event: DiffChangeEvent) => void;

/**
 * Framework-agnostic state manager.
 * Holds per-workspace local/remote indexes and the computed diff.
 * Emits change events when a recompute happens.
 */
export class SyncStateManager {
  private localIndexByWorkspace = new Map<string, Map<string, FileMeta>>();
  private remoteIndexByWorkspace = new Map<string, Map<string, FileMeta>>();
  private diffByWorkspace = new Map<string, Map<string, DiffEntry>>();
  private batchingWorkspaces = new Set<string>();

  private diffListeners = new Set<Listener>();

  constructor(private readonly diffEngine: DiffEngine) {}

  subscribeToDiffChanges(listener: Listener): () => void {
    this.diffListeners.add(listener);
    return () => {
      this.diffListeners.delete(listener);
    };
  }

  setLocalIndex(workspaceId: string, index: Map<string, FileMeta>): void {
    this.localIndexByWorkspace.set(workspaceId, index);
    this.recompute(workspaceId);
  }

  setRemoteIndex(workspaceId: string, index: Map<string, FileMeta>): void {
    this.remoteIndexByWorkspace.set(workspaceId, index);
    this.recompute(workspaceId);
  }

  applyLocal(event: {
    workspaceId: string;
    type: LocalEventType;
    path: string;
    meta?: FileMeta;
    newPath?: string;
  }): void {
    const localIndex = this.ensureWorkspaceMap(this.localIndexByWorkspace, event.workspaceId);

    if (event.type === 'create' || event.type === 'modify') {
      localIndex.set(event.path, event.meta!);
    } else if (event.type === 'delete') {
      localIndex.delete(event.path);
    } else if (event.type === 'rename') {
      localIndex.delete(event.path);
      if (event.meta && event.newPath) {
        localIndex.set(event.newPath, event.meta);
      }
    }

    this.recompute(event.workspaceId, event.path);
  }

  applyRemote(event: {
    workspaceId: string;
    type: RemoteEventType;
    path: string;
    meta?: FileMeta;
    newPath?: string;
  }): void {
    const remoteIndex = this.ensureWorkspaceMap(this.remoteIndexByWorkspace, event.workspaceId);

    if (event.type === 'create' || event.type === 'modify') {
      remoteIndex.set(event.path, event.meta!);
    } else if (event.type === 'delete') {
      remoteIndex.delete(event.path);
    } else if (event.type === 'rename') {
      remoteIndex.delete(event.path);
      if (event.meta && event.newPath) {
        remoteIndex.set(event.newPath, event.meta);
      }
    }

    this.recompute(event.workspaceId, event.path);
  }

  getDiffEntry(workspaceId: string, path: string): DiffEntry | undefined {
    const diffMap = this.ensureWorkspaceMap(this.diffByWorkspace, workspaceId);
    return diffMap.get(path);
  }

  getChildren(workspaceId: string, parentPath?: string): string[] {
    const prefix = parentPath ? parentPath + '/' : '';
    const diffMap = this.ensureWorkspaceMap(this.diffByWorkspace, workspaceId);

    const childPaths = new Set<string>();
    for (const fullPath of diffMap.keys()) {
      if (!fullPath.startsWith(prefix)) {
        continue;
      }
      const remainder = fullPath.slice(prefix.length);
      const firstSegment = remainder.split('/')[0];
      if (firstSegment && remainder.length > 0) {
        childPaths.add(prefix + firstSegment);
      }
    }
    return Array.from(childPaths).sort();
  }

  private recompute(workspaceId: string, touchedPath?: string): void {
    if (this.batchingWorkspaces?.has && this.batchingWorkspaces.has(workspaceId)) {
      return;
    }

    const localIndex = this.ensureWorkspaceMap(this.localIndexByWorkspace, workspaceId);
    const remoteIndex = this.ensureWorkspaceMap(this.remoteIndexByWorkspace, workspaceId);

    // use folder-aware diff if available
    const newDiff = (this.diffEngine.computeWithFolders ?? this.diffEngine.computeFull).call(
      this.diffEngine,
      localIndex,
      remoteIndex
    );

    this.diffByWorkspace.set(workspaceId, newDiff);

    const parentPath = touchedPath ? this.dirnameRelative(touchedPath) || undefined : undefined;
    this.emitDiffChange({ workspaceId, parentPath, changedPath: touchedPath });
  }

  private ensureWorkspaceMap<T>(
    byWorkspace: Map<string, Map<string, T>>,
    workspaceId: string
  ): Map<string, T> {
    if (!byWorkspace.has(workspaceId)) {
      byWorkspace.set(workspaceId, new Map<string, T>());
    }
    return byWorkspace.get(workspaceId)!;
  }

  private emitDiffChange(event: DiffChangeEvent): void {
    for (const listener of this.diffListeners) {
      listener(event);
    }
  }

  private dirnameRelative(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash < 0) {
      return '';
    }
    return path.slice(0, lastSlash);
  }
  
  public getLocalIndex(workspaceId: string): Map<string, FileMeta> {
    const index = this.ensureWorkspaceMap(this.localIndexByWorkspace, workspaceId);
    return new Map(index);
  }

  public getRemoteIndex(workspaceId: string): Map<string, FileMeta> {
    const index = this.ensureWorkspaceMap(this.remoteIndexByWorkspace, workspaceId);
    return new Map(index);
  }

  public getLocalMeta(workspaceId: string, path: string): FileMeta | undefined {
    const index = this.ensureWorkspaceMap(this.localIndexByWorkspace, workspaceId);
    return index.get(path);
  }

  public getRemoteMeta(workspaceId: string, path: string): FileMeta | undefined {
    const index = this.ensureWorkspaceMap(this.remoteIndexByWorkspace, workspaceId);
    return index.get(path);
  }

  // Return a shallow copy of the whole diff map (read-only for callers)
  public getDiffEntries(workspaceId: string): Map<string, DiffEntry> {
    const index = this.ensureWorkspaceMap(this.diffByWorkspace, workspaceId);
    return new Map(index);
  }

  public runBatch(workspaceId: string, hintPath: string | undefined, fn: () => void): void {
    this.batchingWorkspaces.add(workspaceId);
    try {
      fn();
    } finally {
      this.batchingWorkspaces.delete(workspaceId);
      this.recompute(workspaceId, hintPath);
    }
  }

}
