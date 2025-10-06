import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceConfigData, EffectiveWorkspaceConfig } from './WorkspaceConfig';
import { ActionPolicy, parseActionPolicy } from './ActionPolicy';

export class WorkspaceConfigService {
  private readonly cache = new Map<string, EffectiveWorkspaceConfig>();
  private readonly emitter = new vscode.EventEmitter<{ workspaceId: string }>();
  public readonly onDidChange = this.emitter.event;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    // Watch each folder's livesync.json
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(folder, '.vscode/livesync.json');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);

      watcher.onDidCreate(() => { this.reload(folder); });
      watcher.onDidChange(() => { this.reload(folder); });
      watcher.onDidDelete(() => { this.remove(folder); });
      this.ctx.subscriptions.push(watcher);
    }
  }

  public async get(folder: vscode.WorkspaceFolder): Promise<EffectiveWorkspaceConfig> {
    const id = folder.uri.fsPath;
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    const loaded = await this.loadFromDisk(folder);
    this.cache.set(id, loaded);
    return loaded;
  }

  public async getById(workspaceId: string) {
    const cached = this.cache.get(workspaceId);
    if (cached) { return cached; }
    const filePath = path.join(workspaceId, '.vscode', 'livesync.json');
    let data: any = {};
    try { data = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch {}
    const ignoreGlobs = toExcludeGlobs(data.ignoreList ?? []);
    const hasRemote = !!data.hostname && !!data.remotePath;
    const eff = { data, ignoreGlobs, hasRemote };
    this.cache.set(workspaceId, eff);
    return eff;
  }

  public getSync(folder: vscode.WorkspaceFolder): EffectiveWorkspaceConfig | undefined {
    return this.cache.get(folder.uri.fsPath);
  }

  private async reload(folder: vscode.WorkspaceFolder): Promise<void> {
    const eff = await this.loadFromDisk(folder);
    this.cache.set(folder.uri.fsPath, eff);
    this.emitter.fire({ workspaceId: folder.uri.fsPath });
  }

  private remove(folder: vscode.WorkspaceFolder): void {
    this.cache.delete(folder.uri.fsPath);
    this.emitter.fire({ workspaceId: folder.uri.fsPath });
  }

  private async loadFromDisk(folder: vscode.WorkspaceFolder): Promise<EffectiveWorkspaceConfig> {
    const filePath = path.join(folder.uri.fsPath, '.vscode', 'livesync.json');
    let data: WorkspaceConfigData = {};
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      data = JSON.parse(raw) as WorkspaceConfigData;
    } catch {
      // missing or malformed -> fall back to empty defaults
    }

    const ignoreGlobs = toExcludeGlobs(data.ignoreList ?? []);
    const hasRemote = !!data.hostname && !!data.remotePath;

    return { data, ignoreGlobs, hasRemote };
  }
}

function toExcludeGlobs(ignoreList: string[]): string[] {
  // Convert entries like ".vscode" => ["**/.vscode/**", "**/.vscode"]
  const globs: string[] = [];
  for (const entry of ignoreList) {
    const name = entry.replace(/^[./\\]+/, ''); // sanitize
    globs.push(`**/${name}/**`, `**/${name}`);
  }
  return globs;
}

export interface EffectiveActions {
  onSave: ActionPolicy;
  onCreate: ActionPolicy;
  onDelete: ActionPolicy;
  onMove: ActionPolicy;
  onOpen: ActionPolicy;
  onUpload: ActionPolicy;    // optional, for explicit commands
  onDownload: ActionPolicy;  // optional, for explicit commands
}

export function actionsFromData(data: any): EffectiveActions {
  return {
    onSave:      parseActionPolicy(data.actionOnSave),
    onCreate:    parseActionPolicy(data.actionOnCreate),
    onDelete:    parseActionPolicy(data.actionOnDelete),
    onMove:      parseActionPolicy(data.actionOnMove),
    onOpen:      parseActionPolicy(data.actionOnOpen),
    onUpload:    parseActionPolicy(data.actionOnUpload),
    onDownload:  parseActionPolicy(data.actionOnDownload),
  };
}

// Optionally expose a convenience getter by folder id:
export async function getActionsForId(this: WorkspaceConfigService, workspaceId: string): Promise<EffectiveActions> {
  const eff = await this.getById(workspaceId);
  return actionsFromData(eff.data);
}
// add method on class
(WorkspaceConfigService.prototype as any).getActionsForId = getActionsForId;