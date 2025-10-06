import * as vscode from 'vscode';
import { SyncStateManager } from '@app/SyncStateManager';
import { FolderStateStore } from '@presentation/tree/FolderStateStore';
import { computeRefreshTarget } from './refresh/RefreshPlanner';

// Node identities
type WorkspaceNode = { kind: 'workspace'; workspaceId: string; label: string };
type EntryNode = { kind: 'entry'; workspaceId: string; path: string };
export type ExperimentalNode = WorkspaceNode | EntryNode;

const StatusLabel: Record<string, string> = {
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  unchanged: 'unchanged',
  conflict: 'conflict'
};

export class ExperimentalTreeProvider implements vscode.TreeDataProvider<ExperimentalNode> {
  private readonly changeEmitter = new vscode.EventEmitter<ExperimentalNode | undefined>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  // stable identities
  private readonly workspaceNodeById = new Map<string, WorkspaceNode>();
  private readonly entryNodeByWs = new Map<string, Map<string, EntryNode>>();
  private readonly realizedEntriesByWs = new Map<string, Set<string>>();

  // UI options
  private showAsTree = true;        // replicate _showAsTree
  private collapseAll = false;      // replicate _collapseAll
  private expandEpoch = 0;          // replicate _expandEpoch (affects IDs)

  // Visibility config
  private showUnchanged: boolean = false;
  private retentionMs: number = 800;

  // Recently-resolved tracker: wsId -> (path -> timeout)
  private readonly recentlyResolvedByWs = new Map<string, Map<string, NodeJS.Timeout>>();

  constructor(
    private readonly state: SyncStateManager,
    private readonly workspaceIds: string[],
    public readonly folderStateStore: FolderStateStore
  ) {
    for (const workspaceId of this.workspaceIds) {
      this.getOrCreateWorkspaceNode(workspaceId);
    }

    this.updateViewConfig();

    this.state.subscribeToDiffChanges(({ workspaceId, changedPath, parentPath }) => {
      const realizedPaths = this.getRealizedPathsSet(workspaceId);
      const entryStillExists = !!(changedPath && this.state.getDiffEntry(workspaceId, changedPath));

      const decision = computeRefreshTarget({
        changedPath,
        parentPath,
        entryStillExists,
        realizedPaths
      });

      if (decision.kind === 'file') {
        this.changeEmitter.fire(this.getOrCreateEntryNode(workspaceId, decision.path));
      } else if (decision.kind === 'parent') {
        this.changeEmitter.fire(this.getOrCreateEntryNode(workspaceId, decision.path!));
      } else {
        this.changeEmitter.fire(this.getOrCreateWorkspaceNode(workspaceId));
      }
    });
  }

  // NEW: called from activate() when settings change
  public updateViewConfig(): void {
    const config = vscode.workspace.getConfiguration('livesync');
    this.showUnchanged = config.get<boolean>('view.showUnchanged') ?? false;
    this.retentionMs = config.get<number>('view.recentlyResolvedRetentionMs') ?? 800;
    this.changeEmitter.fire(undefined); // refresh with new filter behavior
  }

  // NEW: mark a batch of paths (and all ancestors) as recently resolved
  public markRecentlyResolvedBatch(workspaceId: string, paths: string[]): void {
    if (this.retentionMs <= 0) {
      return;
    }
    const allPaths = new Set<string>();
    for (const path of paths) {
      allPaths.add(path);
      for (const ancestor of this.ancestorPaths(path)) {
        allPaths.add(ancestor);
      }
    }
    for (const path of allPaths) {
      this.markRecentlyResolved(workspaceId, path);
    }
  }

  private markRecentlyResolved(workspaceId: string, path: string): void {
    let mapForWs = this.recentlyResolvedByWs.get(workspaceId);
    if (!mapForWs) {
      mapForWs = new Map<string, NodeJS.Timeout>();
      this.recentlyResolvedByWs.set(workspaceId, mapForWs);
    }

    // Reset existing timer if any
    const existing = mapForWs.get(path);
    if (existing) {
      clearTimeout(existing);
    }

    // Start retention timer
    const timeout = setTimeout(() => {
      // Remove from set and refresh parent so it can vanish
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
  }

  private isRecentlyResolved(workspaceId: string, path: string): boolean {
    const set = this.recentlyResolvedByWs.get(workspaceId);
    return Boolean(set?.has(path));
  }

  // getTreeItem(...) stays as we last wrote it (no iconPath, uses resourceUri)

  async getChildren(element?: ExperimentalNode): Promise<ExperimentalNode[]> {
    if (!element) {
      return this.workspaceIds.map((workspaceId) => {
        return this.getOrCreateWorkspaceNode(workspaceId);
      });
    }

    if (element.kind === 'workspace') {
      const childPathsRaw = this.state.getChildren(element.workspaceId, undefined);
      const childPaths = this.filterByVisibility(element.workspaceId, childPathsRaw);
      const nodes = childPaths.map((path) => this.getOrCreateEntryNode(element.workspaceId, path));
      this.markRealized(element.workspaceId, nodes.map((n) => n.path));
      return nodes;
    }

    // element.kind === 'entry'
    this.markRealized(element.workspaceId, [element.path]);

    const childPathsRaw = this.state.getChildren(element.workspaceId, element.path);
    const childPaths = this.filterByVisibility(element.workspaceId, childPathsRaw);
    const nodes = childPaths.map((path) => this.getOrCreateEntryNode(element.workspaceId, path));
    this.markRealized(element.workspaceId, nodes.map((n) => n.path));
    return nodes;
  }

  // Public toggles if you wire them to settings/commands later
  setShowAsTree(value: boolean): void {
    this.showAsTree = value;
    this.bumpExpandEpochAndRefreshAll();
  }
  setCollapseAll(value: boolean): void {
    this.collapseAll = value;
    this.bumpExpandEpochAndRefreshAll();
  }

  getTreeItem(element: ExperimentalNode): vscode.TreeItem {
    if (element.kind === 'workspace') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `ws:${element.workspaceId}::${this.expandEpoch}`;
      item.contextValue = 'workspace';
      item.iconPath = new vscode.ThemeIcon('root-folder');
      return item;
    }

    const diffEntry = this.state.getDiffEntry(element.workspaceId, element.path);
    const hasChildren = this.state.getChildren(element.workspaceId, element.path).length > 0;
    const isFolder = (diffEntry?.type === 'folder') || (!diffEntry && hasChildren);

    // Label logic: show only the basename when showAsTree=true; otherwise the relative path
    const label = this.showAsTree ? this.basename(element.path) : element.path;

    // Collapsible logic: replicate your "shouldBeOpen = !collapseAll && isMarkedOpen"
    let collapsibleState = vscode.TreeItemCollapsibleState.None;
    if (isFolder) {
      const isMarkedOpen = this.folderStateStore.isOpen(element.workspaceId, element.path);
      const shouldBeOpen = !this.collapseAll && isMarkedOpen;
      collapsibleState = shouldBeOpen
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }

    const item = new vscode.TreeItem(label, collapsibleState);

    // Stable-ish ID; include epoch so switching showAsTree/collapseAll forces refresh
    item.id = `ws:${element.workspaceId}::${element.path || '.'}::${this.expandEpoch}`;

    // Icons + context + description (status-based)
    const status = diffEntry?.status ?? 'unchanged';
    item.description = StatusLabel[status];
    item.contextValue = `fileEntry-${isFolder ? 'directory' : 'file'}-${status}`;

    // Resource URI with query for FileDecorationProvider (status-aware)
    item.resourceUri = this.buildResourceUri(element.workspaceId, element.path, status);

    // Open-file command only for files not removed
    if (!isFolder && status !== 'removed') {
      item.command = {
        command: 'livesync.openFile',
        title: 'Open File',
        arguments: [this.absoluteFsPath(element.workspaceId, element.path)]
      };
    }

    return item;
  }

  // ---------- helpers

  private getOrCreateWorkspaceNode(workspaceId: string): WorkspaceNode {
    let node = this.workspaceNodeById.get(workspaceId);
    if (!node) {
      node = { kind: 'workspace', workspaceId, label: this.labelOf(workspaceId) };
      this.workspaceNodeById.set(workspaceId, node);
    }
    return node;
  }

  private getOrCreateEntryNode(workspaceId: string, path: string): EntryNode {
    let mapForWs = this.entryNodeByWs.get(workspaceId);
    if (!mapForWs) {
      mapForWs = new Map<string, EntryNode>();
      this.entryNodeByWs.set(workspaceId, mapForWs);
    }
    let node = mapForWs.get(path);
    if (!node) {
      node = { kind: 'entry', workspaceId, path };
      mapForWs.set(path, node);
    }
    return node;
  }

  private getRealizedPathsSet(workspaceId: string): Set<string> {
    let set = this.realizedEntriesByWs.get(workspaceId);
    if (!set) {
      set = new Set<string>();
      this.realizedEntriesByWs.set(workspaceId, set);
    }
    return set;
  }

  private markRealized(workspaceId: string, paths: string[]): void {
    const set = this.getRealizedPathsSet(workspaceId);
    for (const path of paths) {
      set.add(path);
    }
  }

  private buildResourceUri(workspaceId: string, relativePath: string, status: string): vscode.Uri {
    const fsPath = this.absoluteFsPath(workspaceId, relativePath);
    return vscode.Uri.file(fsPath).with({ query: `?status=${StatusLabel[status] ?? status}` });
  }

  private absoluteFsPath(workspaceId: string, relativePath: string): string {
    // workspaceId is folder.uri.fsPath
    const normalizedRoot = workspaceId.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedRel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    return `${normalizedRoot}/${normalizedRel}`;
  }

  private basename(pathString: string): string {
    const lastSlashIndex = pathString.lastIndexOf('/');
    if (lastSlashIndex < 0) {
      return pathString;
    }
    return pathString.slice(lastSlashIndex + 1);
  }

  private labelOf(workspaceId: string): string {
    const normalized = workspaceId.replace(/\\/g, '/');
    const lastSlashIndex = normalized.lastIndexOf('/');
    if (lastSlashIndex < 0) {
      return normalized;
    }
    return normalized.slice(lastSlashIndex + 1);
  }

  private bumpExpandEpochAndRefreshAll(): void {
    this.expandEpoch += 1;
    this.changeEmitter.fire(undefined);
  }

  public getWorkspaceNode(workspaceId: string) {
    return this['getOrCreateWorkspaceNode'](workspaceId); // uses the existing method
  }

  // Apply showUnchanged + recentlyResolved logic
  private filterByVisibility(workspaceId: string, paths: string[]): string[] {
    if (this.showUnchanged) {
      return paths;
    }
    const filtered: string[] = [];
    for (const path of paths) {
      const entry = this.state.getDiffEntry(workspaceId, path);
      const isChanged = entry ? entry.status !== 'unchanged' : false;
      const keep = isChanged || this.isRecentlyResolved(workspaceId, path);
      if (keep) {
        filtered.push(path);
      }
    }
    return filtered;
  }

  private parentPath(pathString: string): string | undefined {
    const lastSlashIndex = pathString.lastIndexOf('/');
    if (lastSlashIndex < 0) {
      return undefined;
    }
    return pathString.slice(0, lastSlashIndex);
  }

  private ancestorPaths(pathString: string): string[] {
    const ancestors: string[] = [];
    let current = this.parentPath(pathString);
    while (current && current.length > 0) {
      ancestors.push(current);
      current = this.parentPath(current);
    }
    return ancestors;
  }

}
