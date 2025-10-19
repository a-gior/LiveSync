import * as vscode from 'vscode';

export class StorageService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  // ----- workspace-scoped -----
  getW<T>(key: string, def: T): T {
    const v = this.context.workspaceState.get<T>(key);
    return (v === undefined ? def : v);
  }
  setW<T>(key: string, value: T): Thenable<void> {
    return this.context.workspaceState.update(key, value);
  }

  // ----- global-scoped -----
  getG<T>(key: string, def: T): T {
    const v = this.context.globalState.get<T>(key);
    return (v === undefined ? def : v);
  }
  setG<T>(key: string, value: T): Thenable<void> {
    return this.context.globalState.update(key, value);
  }

  // Small helpers for “set of strings” patterns
  addToWSet(key: string, value: string): Thenable<void> {
    const cur = new Set(this.getW<string[]>(key, []));
    cur.add(value);
    return this.setW(key, Array.from(cur));
  }
  removeFromWSet(key: string, value: string): Thenable<void> {
    const cur = new Set(this.getW<string[]>(key, []));
    cur.delete(value);
    return this.setW(key, Array.from(cur));
  }
}
