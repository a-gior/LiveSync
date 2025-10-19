// src/storage/ConfigErrorSuppressor.ts
import type * as vscode from 'vscode';
import type { WorkspaceId } from '@domain/types';
import { StorageService } from '@infra/storage/StorageService';

const SUPPRESS_CONFIG_ERROR_KEY = 'livesync.suppressedConfigErrors'; // array<string> of workspaceIds (fsPaths)

/**
 * Keeps a per-workspace set of ids for which config errors should be suppressed.
 * Persistence lives in workspaceState to keep it local to the current VS Code workspace.
 */
export class ConfigErrorSuppressor {
  constructor(private readonly storage: StorageService) {}

  isSuppressed(workspaceId: WorkspaceId): boolean {
    const list = this.storage.getW<string[]>(SUPPRESS_CONFIG_ERROR_KEY, []);
    return list.includes(workspaceId as unknown as string);
  }

  async suppress(workspaceId: WorkspaceId): Promise<void> {
    return await this.storage.addToWSet(SUPPRESS_CONFIG_ERROR_KEY, workspaceId as unknown as string);
  }

  async clear(workspaceId: WorkspaceId): Promise<void> {
    return await this.storage.removeFromWSet(SUPPRESS_CONFIG_ERROR_KEY, workspaceId as unknown as string);
  }

  /** Optional helper: clean entries for folders no longer open. */
  async pruneToOpenFolders(folders: readonly vscode.WorkspaceFolder[]): Promise<void> {
    const open = new Set(folders.map(f => f.uri.fsPath));
    const cur = new Set(this.storage.getW<string[]>(SUPPRESS_CONFIG_ERROR_KEY, []));
    let changed = false;
    for (const v of Array.from(cur)) {
      if (!open.has(v)) {
        cur.delete(v);
        changed = true;
      }
    }
    if (!changed) { return Promise.resolve(); }
    return await this.storage.setW(SUPPRESS_CONFIG_ERROR_KEY, Array.from(cur));
  }
}
