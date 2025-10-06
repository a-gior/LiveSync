import * as vscode from 'vscode';

/**
 * Stores "is folder expanded" flags per workspace + relative path.
 * Uses workspaceState (per-workspace window) to persist UI state.
 */
export class FolderStateStore {
  private readonly key = 'livesync.folderStates';

  constructor(private readonly state: vscode.Memento) {}

  isOpen(workspaceId: string, relativePath: string): boolean {
    const all = this.state.get<Record<string, Record<string, boolean>>>(this.key, {});
    return Boolean(all[workspaceId]?.[relativePath]);
  }

  setOpen(workspaceId: string, relativePath: string, open: boolean): void {
    const all = this.state.get<Record<string, Record<string, boolean>>>(this.key, {});
    if (!all[workspaceId]) {
      all[workspaceId] = {};
    }
    all[workspaceId][relativePath] = open;
    this.state.update(this.key, all);
  }
}
