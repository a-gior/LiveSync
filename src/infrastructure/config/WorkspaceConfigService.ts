import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { WorkspaceId } from '@domain/types';
import { stringToWsId } from '@helpers/path';
import type { WorkspaceConfigData } from './WorkspaceConfig';
import { IgnoreFilter } from '@helpers/ignore';

export interface EffectiveWorkspaceConfig {
  data: WorkspaceConfigData;
  ignoreFilter: IgnoreFilter;
  ignoreGlobs: readonly string[]; // Backward compat - deprecated, use ignoreFilter instead
  hasRemote: boolean;
}

export type ConfigChangeEvent = {
  workspaceId: WorkspaceId;
};

/**
 * Manages workspace-level configuration with caching and change notifications.
 * 
 * Each workspace folder has a `.vscode/livesync.json` file containing:
 * - Connection settings (hostname, port, credentials, remotePath)
 * - File event actions (actionOnSave, actionOnCreate, etc.)
 * - Ignore patterns (ignoreList)
 * 
 * The service:
 * - Loads and caches configurations
 * - Expands ignore patterns to comprehensive globs (using IgnoreFilter)
 * - Watches for config file changes
 * - Emits events when configs change
 */
export class WorkspaceConfigService {
  private cache = new Map<string, EffectiveWorkspaceConfig>();
  private emitter = new vscode.EventEmitter<ConfigChangeEvent>();
  private watchers: Array<{ watcher: vscode.FileSystemWatcher; folderUri: string }> = [];

  readonly onConfigChange = this.emitter.event;

  constructor() {
    this.setupWorkspaceFolderWatching();
  }

  dispose(): void {
    this.emitter.dispose();
    this.watchers.forEach(item => item.watcher.dispose());
    this.watchers = [];
    this.cache.clear();
  }

  /**
   * Get effective config for a workspace folder (with caching)
   */
  async get(folder: vscode.WorkspaceFolder): Promise<EffectiveWorkspaceConfig> {
    const workspaceId = folder.uri.fsPath;
    const cached = this.cache.get(workspaceId);
    if (cached) {
      return cached;
    }
    return await this.loadFromDisk(folder);
  }

  /**
   * Get effective config by workspace ID (with caching)
   */
  async getById(workspaceId: WorkspaceId): Promise<EffectiveWorkspaceConfig> {
    const cached = this.cache.get(workspaceId);
    if (cached) {
      return cached;
    }

    const folder = vscode.workspace.workspaceFolders?.find(
      f => f.uri.fsPath === workspaceId
    );

    if (!folder) {
      return {
        data: {},
        ignoreFilter: new IgnoreFilter([]),
        ignoreGlobs: [],
        hasRemote: false
      };
    }

    return await this.loadFromDisk(folder);
  }

  /**
   * Get synchronously from cache (returns undefined if not cached)
   */
  getSync(folder: vscode.WorkspaceFolder): EffectiveWorkspaceConfig | undefined {
    return this.cache.get(folder.uri.fsPath);
  }

  /**
   * Force-reload config from disk without firing onConfigChange (for use in tests).
   * Bypasses the file watcher and does NOT clear the validator cache, so subsequent
   * operations that check config validity continue to work correctly.
   */
  async reloadFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    await this.loadFromDisk(folder); // loadFromDisk already sets the cache
  }

  /**
   * Force reload config from disk
   */
  private async reload(folder: vscode.WorkspaceFolder): Promise<void> {
    const eff = await this.loadFromDisk(folder);
    this.cache.set(folder.uri.fsPath, eff);
    this.emitter.fire({ workspaceId: stringToWsId(folder.uri.fsPath) });
  }

  /**
   * Remove cached config when folder is removed
   */
  private remove(folder: vscode.WorkspaceFolder): void {
    this.cache.delete(folder.uri.fsPath);
    this.emitter.fire({ workspaceId: stringToWsId(folder.uri.fsPath) });
  }

  /**
   * Load and parse config from disk, creating IgnoreFilter
   */
  private async loadFromDisk(folder: vscode.WorkspaceFolder): Promise<EffectiveWorkspaceConfig> {
    const filePath = path.join(folder.uri.fsPath, '.vscode', 'livesync.json');
    let data: WorkspaceConfigData = {};
    
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      data = JSON.parse(raw) as WorkspaceConfigData;
    } catch {
      // missing or malformed -> fall back to empty defaults
    }

    // Create IgnoreFilter which handles pattern expansion and .livesync auto-exclusion
    const ignoreFilter = new IgnoreFilter(data.ignoreList ?? []);
    const hasRemote = !!data.hostname && !!data.remotePath;
    
    const eff = {
      data,
      ignoreFilter,
      ignoreGlobs: ignoreFilter.globs, // Backward compat
      hasRemote
    };
    
    this.cache.set(folder.uri.fsPath, eff);
    return eff;
  }

  /**
   * Watch for workspace folder additions/removals and config file changes
   */
  private setupWorkspaceFolderWatching(): void {
    // Watch for workspace folder changes
    vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
      for (const removed of e.removed) {
        this.remove(removed);
        this.removeWatcherForFolder(removed);
      }
      for (const added of e.added) {
        await this.loadFromDisk(added);
        this.createWatcherForFolder(added);
      }
    });

    // Watch for config file changes in each workspace
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      this.createWatcherForFolder(folder);
    }
  }

  /**
   * Create a config file watcher for a specific folder
   */
  private createWatcherForFolder(folder: vscode.WorkspaceFolder): void {
    const pattern = new vscode.RelativePattern(folder, '.vscode/livesync.json');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    watcher.onDidCreate(() => this.reload(folder));
    watcher.onDidChange(() => this.reload(folder));
    watcher.onDidDelete(() => this.reload(folder));

    this.watchers.push({ watcher, folderUri: folder.uri.toString() });
  }

  /**
   * Remove watcher for a specific folder
   */
  private removeWatcherForFolder(folder: vscode.WorkspaceFolder): void {
    const folderUri = folder.uri.toString();
    const remaining: typeof this.watchers = [];
    
    for (const item of this.watchers) {
      if (item.folderUri === folderUri) {
        item.watcher.dispose();
      } else {
        remaining.push(item);
      }
    }
    
    this.watchers = remaining;
  }
}