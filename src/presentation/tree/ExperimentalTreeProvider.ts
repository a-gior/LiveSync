import * as vscode from 'vscode';
import { SyncStateManager } from '@app/SyncStateManager';
import { FolderStateStore } from '@presentation/tree/FolderStateStore';
import { computeRefreshTarget } from './refresh/RefreshPlanner';

import type { WorkspaceId, RelPath, DiffStatus } from '@domain/types';
import { stringToRel } from '@helpers/path';

// -------------------------------------------------------------------------------------
// Public node identities emitted by this provider (used by commands/context menus)
// -------------------------------------------------------------------------------------

type WorkspaceNode = { kind: 'workspace'; workspaceId: WorkspaceId; label: string };
type EntryNode     = { kind: 'entry';     workspaceId: WorkspaceId; path: RelPath };
export type ExperimentalNode = WorkspaceNode | EntryNode;

// Human-readable labels for statuses
const StatusLabel: Record<DiffStatus, string> = {
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  unchanged: 'unchanged',
  conflict: 'conflict',
};

export class ExperimentalTreeProvider implements vscode.TreeDataProvider<ExperimentalNode> {
  private readonly changeEmitter = new vscode.EventEmitter<ExperimentalNode | undefined>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  private currentWorkspaceId: WorkspaceId;

  // Track all active timers for cleanup
  private readonly activeTimers = new Set<NodeJS.Timeout>();
  private isDisposed = false;
  private readonly disposeCallbacks: Array<() => void> = [];

  // Stable identities to avoid object churn
  private readonly workspaceNodeById = new Map<WorkspaceId, WorkspaceNode>();
  private readonly entryNodeByWs     = new Map<WorkspaceId, Map<RelPath, EntryNode>>();
  private readonly realizedByWs      = new Map<WorkspaceId, Set<RelPath>>();

  // UI options
  private showAsTree: boolean = true;
  private collapseAll: boolean = false;
  private expandEpoch: number = 0;     // affects IDs → forces tree refresh

  // Visibility config
  private showUnchanged: boolean = false;
  private retentionMs: number = 800;

  // Recently-resolved tracker: wsId -> (path -> timeout)
  private readonly recentlyResolvedByWs = new Map<WorkspaceId, Map<RelPath, NodeJS.Timeout>>();

  constructor(
    private readonly state: SyncStateManager,
    initialWorkspaceId: WorkspaceId,
    public readonly folderStateStore: FolderStateStore
  ) {
    this.currentWorkspaceId = initialWorkspaceId;
    this.getOrCreateWorkspaceNode(initialWorkspaceId);

    // Load config-driven view options immediately
    this.updateViewConfig();

    // Subscribe to targeted diff changes; refresh minimally using the RefreshPlanner
    this.state.subscribeToDiffChanges(({ workspaceId, changedPath, parentPath }) => {
      const realizedPaths = this.getRealizedPathsSet(workspaceId);
      const entryStillExists = Boolean(changedPath && this.state.getDiffEntry(workspaceId, stringToRel(changedPath)));

      const decision = computeRefreshTarget({
        changedPath: changedPath as string | undefined,
        parentPath : parentPath  as string | undefined,
        entryStillExists,
        realizedPaths: new Set<string>([...realizedPaths].map(p => p as unknown as string)),
      });

      if (decision.kind === 'file') {
        this.changeEmitter.fire(this.getOrCreateEntryNode(workspaceId, stringToRel(decision.path)));
      } else if (decision.kind === 'parent') {
        this.changeEmitter.fire(this.getOrCreateEntryNode(workspaceId, stringToRel(decision.path ?? '')));
      } else {
        this.changeEmitter.fire(this.getOrCreateWorkspaceNode(workspaceId));
      }
    });

    // Subscribe to diff changes with cleanup tracking
    const unsubscribe = this.state.subscribeToDiffChanges(({ workspaceId, changedPath, parentPath }) => {
      if (this.isDisposed) {return;} // Guard against post-disposal events

      const realizedPaths = this.getRealizedPathsSet(workspaceId);
      const entryStillExists = Boolean(changedPath && this.state.getDiffEntry(workspaceId, stringToRel(changedPath)));

      const decision = computeRefreshTarget({
        changedPath: changedPath as string | undefined,
        parentPath : parentPath  as string | undefined,
        entryStillExists,
        realizedPaths: new Set<string>([...realizedPaths].map(p => p as unknown as string)),
      });

      if (decision.kind === 'file') {
        this.changeEmitter.fire(this.getOrCreateEntryNode(workspaceId, stringToRel(decision.path)));
      } else if (decision.kind === 'parent') {
        this.changeEmitter.fire(this.getOrCreateEntryNode(workspaceId, stringToRel(decision.path ?? '')));
      } else {
        this.changeEmitter.fire(this.getOrCreateWorkspaceNode(workspaceId));
      }
    });

    // Store unsubscribe function for disposal
    this.disposeCallbacks.push(unsubscribe);
  }

  public dispose(): void {
    if (this.isDisposed) {return;}
    this.isDisposed = true;

    // Clear all active timers
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    // Clear all recently-resolved timers
    for (const [, mapForWs] of this.recentlyResolvedByWs) {
      for (const timer of mapForWs.values()) {
        clearTimeout(timer);
      }
      mapForWs.clear();
    }
    this.recentlyResolvedByWs.clear();

    // Clean up event emitter
    this.changeEmitter.dispose();

    // Call all registered disposal callbacks
    for (const dispose of this.disposeCallbacks) {
      try {
        dispose();
      } catch (err) {
        console.error('[ExperimentalTreeProvider] Error during disposal:', err);
      }
    }
    this.disposeCallbacks.length = 0;
  }

  public setCurrentWorkspace(workspaceId: WorkspaceId): void {
    if (this.currentWorkspaceId !== workspaceId) {
      this.currentWorkspaceId = workspaceId;
      this.refreshAll();
    }
  }

  /**
   * Get the currently displayed workspace ID
   */
  public getCurrentWorkspace(): WorkspaceId | undefined {
    return this.currentWorkspaceId;
  }

  // =====================================================================================
  // View configuration (called from activate() when settings change)
  // =====================================================================================

  public updateViewConfig(): void {
    const config = vscode.workspace.getConfiguration('livesync');
    this.showUnchanged = (config.get<boolean>('view.showUnchanged') ?? false);
    this.retentionMs   = (config.get<number>('view.recentlyResolvedRetentionMs') ?? 800);
    this.changeEmitter.fire(undefined); // refresh with new filter behavior
  }

  // =====================================================================================
  // Recently-resolved overlay (purely visual; does not change logical diff)
  // =====================================================================================

  /** Mark a batch of paths (and all their ancestors) as "recently resolved" for fade-out behavior. */
  public markRecentlyResolvedBatch(workspaceId: WorkspaceId, paths: RelPath[]): void {
    if (this.retentionMs <= 0) {
      return;
    }
    const all = new Set<RelPath>();
    for (const p of paths) {
      all.add(p);
      for (const a of this.ancestorPaths(p)) {
        all.add(a);
      }
    }
    for (const p of all) {
      this.markRecentlyResolved(workspaceId, p);
    }
  }

  private markRecentlyResolved(workspaceId: WorkspaceId, path: RelPath): void {
    if (this.isDisposed) return;
    
    let mapForWs = this.recentlyResolvedByWs.get(workspaceId);
    if (!mapForWs) {
      mapForWs = new Map<RelPath, NodeJS.Timeout>();
      this.recentlyResolvedByWs.set(workspaceId, mapForWs);
    }

    // Reset existing timer if any
    const existing = mapForWs.get(path);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(existing);
    }

    // Start retention timer and refresh parent on expiry so the item can vanish
    const timeout = setTimeout(() => {
      if (this.isDisposed) return;

      const store = this.recentlyResolvedByWs.get(workspaceId);
      if (store) {
        store.delete(path);
      }

      const parentPath = this.parentPath(path);
      const nodeToRefresh = parentPath
        ? this.getOrCreateEntryNode(workspaceId, parentPath)
        : this.getOrCreateWorkspaceNode(workspaceId);

      this.changeEmitter.fire(nodeToRefresh);
    }, this.retentionMs);

    mapForWs.set(path, timeout);
    this.activeTimers.add(timeout);
  }

  private isRecentlyResolved(workspaceId: WorkspaceId, path: RelPath): boolean {
    const set = this.recentlyResolvedByWs.get(workspaceId);
    return Boolean(set?.has(path));
  }

  // =====================================================================================
  // vscode.TreeDataProvider<T>
  // =====================================================================================

  public refreshAll(): void {
    this.changeEmitter.fire(undefined);
  }

  /**
   * Returns the parent of the given element.
   */
  getParent(element: ExperimentalNode): ExperimentalNode | undefined {
    // Workspace nodes have no parent
    if (element.kind === 'workspace') {
      return undefined;
    }

    // Entry nodes: find their parent based on path
    const parentRelPath = this.parentPath(element.path);
    
    // If no parent path, this is a root-level entry under the workspace
    if (!parentRelPath || parentRelPath.length === 0) {
      // In single-workspace mode, entries are directly under the root
      // In multi-workspace mode, entries are under their workspace node
      // For now, return undefined (root level)
      return undefined;
    }

    // Return the parent entry node
    return this.getOrCreateEntryNode(element.workspaceId, parentRelPath);
  }

  async getChildren(element?: ExperimentalNode): Promise<ExperimentalNode[]> {
    if (!element) {
      // In single-workspace mode, return workspace node; in multi-root, return entries directly
      const raw = this.state.getChildren(this.currentWorkspaceId, undefined);
      const filtered = this.filterByVisibility(this.currentWorkspaceId, raw);
      const nodes = filtered.map((p) => this.getOrCreateEntryNode(this.currentWorkspaceId, p));
      this.markRealized(this.currentWorkspaceId, nodes.map((n) => n.path));
      return nodes;
    }

    if (element.kind === 'workspace') {
      const raw = this.state.getChildren(element.workspaceId, undefined);
      const filtered = this.filterByVisibility(element.workspaceId, raw);
      const nodes = filtered.map((p) => this.getOrCreateEntryNode(element.workspaceId, p));
      this.markRealized(element.workspaceId, nodes.map((n) => n.path));
      return nodes;
    }

    // element.kind === 'entry'
    this.markRealized(element.workspaceId, [element.path]);

    const raw = this.state.getChildren(element.workspaceId, element.path);
    const filtered = this.filterByVisibility(element.workspaceId, raw);
    const nodes = filtered.map((p) => this.getOrCreateEntryNode(element.workspaceId, p));
    this.markRealized(element.workspaceId, nodes.map((n) => n.path));
    return nodes;
  }

  getTreeItem(element: ExperimentalNode): vscode.TreeItem {
    if (element.kind === 'workspace') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `ws:${element.workspaceId}::${this.expandEpoch}`;
      item.contextValue = 'workspace';
      item.iconPath = new vscode.ThemeIcon('root-folder');
      return item;
    }

    // Entry node
    const diffEntry = this.state.getDiffEntry(element.workspaceId, element.path);
    const children = this.state.getChildren(element.workspaceId, element.path);
    const hasChildren = children.length > 0;
    const isFolder = (diffEntry?.type === 'folder') || (!diffEntry && hasChildren);

    // Label: basename when showAsTree=true; full relPath otherwise
    const label = this.showAsTree ? this.basename(element.path) : (element.path as string);

    // Collapsible: follow FolderStateStore open/closed + collapseAll override
    let collapsibleState = vscode.TreeItemCollapsibleState.None;
    if (isFolder) {
      const isOpen = this.folderStateStore.isOpen(element.workspaceId as unknown as string, element.path as unknown as string);
      const shouldOpen = (!this.collapseAll) && isOpen;
      collapsibleState = shouldOpen ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    }

    const item = new vscode.TreeItem(label, collapsibleState);

    // Stable-ish ID includes an epoch so toggling layout forces refresh
    item.id = `ws:${element.workspaceId}::${element.path || '.'}::${this.expandEpoch}`;

    // Status → description + context + decoration
    const status: DiffStatus = diffEntry?.status ?? 'unchanged';
    item.description = StatusLabel[status];
    item.contextValue = `fileEntry-${isFolder ? 'directory' : 'file'}-${status}`;
    item.resourceUri = this.buildResourceUri(element.workspaceId, element.path, status);

    // Open-file command only for non-removed files
    if (!isFolder && status !== 'removed') {
      item.command = {
        command: 'livesync.openFile',
        title: 'Open File',
        arguments: [this.absoluteFsPath(element.workspaceId, element.path)],
      };
    }

    return item;
  }

  // =====================================================================================
  // Public toggles (wire them to commands/settings as needed)
  // =====================================================================================

  setShowAsTree(value: boolean): void {
    this.showAsTree = value;
    this.bumpExpandEpochAndRefreshAll();
  }

  setCollapseAll(value: boolean): void {
    this.collapseAll = value;
    this.bumpExpandEpochAndRefreshAll();
  }

  public getWorkspaceNode(workspaceId: WorkspaceId): WorkspaceNode {
    return this.getOrCreateWorkspaceNode(workspaceId);
  }

  // =====================================================================================
  // Internals
  // =====================================================================================

  private getOrCreateWorkspaceNode(workspaceId: WorkspaceId): WorkspaceNode {
    let node = this.workspaceNodeById.get(workspaceId);
    if (!node) {
      node = { kind: 'workspace', workspaceId, label: this.labelOf(workspaceId) };
      this.workspaceNodeById.set(workspaceId, node);
    }
    return node;
  }

  private getOrCreateEntryNode(workspaceId: WorkspaceId, path: RelPath): EntryNode {
    let forWs = this.entryNodeByWs.get(workspaceId);
    if (!forWs) {
      forWs = new Map<RelPath, EntryNode>();
      this.entryNodeByWs.set(workspaceId, forWs);
    }
    let node = forWs.get(path);
    if (!node) {
      node = { kind: 'entry', workspaceId, path };
      forWs.set(path, node);
    }
    return node;
  }

  private getRealizedPathsSet(workspaceId: WorkspaceId): Set<RelPath> {
    let set = this.realizedByWs.get(workspaceId);
    if (!set) {
      set = new Set<RelPath>();
      this.realizedByWs.set(workspaceId, set);
    }
    return set;
  }

  private markRealized(workspaceId: WorkspaceId, paths: RelPath[]): void {
    const set = this.getRealizedPathsSet(workspaceId);
    for (const p of paths) {
      set.add(p);
    }
  }

  private filterByVisibility(workspaceId: WorkspaceId, paths: RelPath[]): RelPath[] {
    if (this.showUnchanged) {
      return paths;
    }
    const filtered: RelPath[] = [];
    for (const p of paths) {
      const entry = this.state.getDiffEntry(workspaceId, p);
      const isChanged = Boolean(entry && entry.status !== 'unchanged');
      const keep = isChanged || this.isRecentlyResolved(workspaceId, p);
      if (keep) {
        filtered.push(p);
      }
    }
    return filtered;
  }

  private buildResourceUri(workspaceId: WorkspaceId, relativePath: RelPath, status: DiffStatus): vscode.Uri {
    const fsPath = this.absoluteFsPath(workspaceId, relativePath);
    // Intentionally keep "?status=" in the query to preserve your existing decoration parser
    return vscode.Uri.file(fsPath).with({ query: `?status=${StatusLabel[status]}` });
  }

  private absoluteFsPath(workspaceId: WorkspaceId, relativePath: RelPath): string {
    const root = (workspaceId as string).replace(/\\/g, '/').replace(/\/+$/, '');
    const rel  = (relativePath as string).replace(/\\/g, '/').replace(/^\/+/, '');
    return `${root}/${rel}`;
  }

  private basename(relPath: RelPath): string {
    const s = relPath as string;
    const i = s.lastIndexOf('/');
    if (i < 0) {
      return s;
    }
    return s.slice(i + 1);
  }

  private labelOf(workspaceId: WorkspaceId): string {
    const norm = (workspaceId as string).replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    if (i < 0) {
      return norm;
    }
    return norm.slice(i + 1);
  }

  private bumpExpandEpochAndRefreshAll(): void {
    this.expandEpoch += 1;
    this.changeEmitter.fire(undefined);
  }

  private parentPath(pathString: RelPath): RelPath | undefined {
    const s = pathString as string;
    const i = s.lastIndexOf('/');
    if (i < 0) {
      return undefined;
    }
    return stringToRel(s.slice(0, i));
  }

  private ancestorPaths(pathString: RelPath): RelPath[] {
    const ancestors: RelPath[] = [];
    let current = this.parentPath(pathString);
    while (current && current.length > 0) {
      ancestors.push(current);
      current = this.parentPath(current);
    }
    return ancestors;
  }
}
