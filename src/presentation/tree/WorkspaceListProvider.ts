import * as vscode from 'vscode';
import { WorkspaceId } from '../../domain/types';
import { basenameRel } from '../../infrastructure/helpers/path';

interface WorkspaceNode {
  kind: 'workspace';
  workspaceId: WorkspaceId;
  label: string;
  hasConfig: boolean;
  configValid: boolean;
}

const SELECTED_WORKSPACE_KEY = 'livesync.selectedWorkspaceId';

export class WorkspaceListProvider implements vscode.TreeDataProvider<WorkspaceNode> {
  private readonly changeEmitter = new vscode.EventEmitter<WorkspaceNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private workspaces = new Map<WorkspaceId, WorkspaceNode>();
  private selectedWorkspaceId: WorkspaceId | undefined;

  constructor(
    initialWorkspaces: WorkspaceId[],
    private readonly onWorkspaceSelected: (wsId: WorkspaceId) => void,
    private readonly state?: vscode.Memento
  ) {
    for (const wsId of initialWorkspaces) {
      this.addWorkspace(wsId);
    }
  }

  public addWorkspace(workspaceId: WorkspaceId): void {
    if (this.workspaces.has(workspaceId)) return;

    const label = basenameRel(workspaceId);
    this.workspaces.set(workspaceId, {
      kind: 'workspace',
      workspaceId,
      label,
      hasConfig: false,
      configValid: false,
    });
    this.refresh();
  }

  public removeWorkspace(workspaceId: WorkspaceId): void {
    this.workspaces.delete(workspaceId);
    if (this.selectedWorkspaceId === workspaceId) {
      this.selectedWorkspaceId = undefined;
      this.clearPersistedSelection();
    }
    this.refresh();
  }

  public updateConfigStatus(workspaceId: WorkspaceId, hasConfig: boolean, configValid: boolean): void {
    const node = this.workspaces.get(workspaceId);
    if (node) {
      node.hasConfig = hasConfig;
      node.configValid = configValid;
      this.refresh();
    }
  }

  public selectWorkspace(workspaceId: WorkspaceId): void {
    if (this.selectedWorkspaceId !== workspaceId) {
      this.selectedWorkspaceId = workspaceId;
      this.onWorkspaceSelected(workspaceId);
      this.persistSelection(workspaceId);
      this.refresh();
    }
  }

  public getSelectedWorkspace(): WorkspaceId | undefined {
    return this.selectedWorkspaceId;
  }

  /**
   * Restore last selected workspace from state if available and valid.
   * Returns the workspace ID that was selected (either restored or first available).
   */
  public restoreSelection(): WorkspaceId | undefined {
    if (!this.state) {
      return this.selectFirstAvailable();
    }

    const stored = this.state.get<string>(SELECTED_WORKSPACE_KEY);
    
    if (stored && this.workspaces.has(stored as WorkspaceId)) {
      this.selectWorkspace(stored as WorkspaceId);
      return this.selectedWorkspaceId;
    }

    return this.selectFirstAvailable();
  }

  private selectFirstAvailable(): WorkspaceId | undefined {
    const firstWsId = Array.from(this.workspaces.keys())[0];
    if (firstWsId) {
      this.selectWorkspace(firstWsId);
    }
    return firstWsId;
  }

  private persistSelection(workspaceId: WorkspaceId): void {
    if (this.state) {
      void this.state.update(SELECTED_WORKSPACE_KEY, workspaceId);
    }
  }

  private clearPersistedSelection(): void {
    if (this.state) {
      void this.state.update(SELECTED_WORKSPACE_KEY, undefined);
    }
  }

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: WorkspaceNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    
    // Highlight selected workspace
    if (element.workspaceId === this.selectedWorkspaceId) {
      item.description = '(selected)';
    }

    // Icon based on config status
    if (!element.hasConfig) {
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground'));
      item.tooltip = 'No LiveSync configuration found';
    } else if (!element.configValid) {
      item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('notificationsErrorIcon.foreground'));
      item.tooltip = 'Invalid or unreachable configuration';
    } else {
      item.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.green'));
      item.tooltip = 'LiveSync configured';
    }

    item.contextValue = 'livesync.workspace';
    item.command = {
      command: 'livesync.selectWorkspace',
      title: 'Select Workspace',
      arguments: [element.workspaceId]
    };

    return item;
  }

  getChildren(): WorkspaceNode[] {
    return Array.from(this.workspaces.values());
  }
}