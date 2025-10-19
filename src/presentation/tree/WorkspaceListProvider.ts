import * as vscode from 'vscode';
import { WorkspaceId } from '@domain/types';
import { wsToString } from '@helpers/path';

type WorkspaceNode = {
  kind: 'workspace';
  workspaceId: WorkspaceId;
  label: string;
  hasConfig: boolean;
  configValid: boolean;
};

export class WorkspaceListProvider implements vscode.TreeDataProvider<WorkspaceNode> {
  private readonly changeEmitter = new vscode.EventEmitter<WorkspaceNode | undefined>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  private workspaces: Map<WorkspaceId, WorkspaceNode> = new Map();
  private selectedWorkspaceId?: WorkspaceId;

  constructor(
    initialWorkspaces: WorkspaceId[],
    private readonly onWorkspaceSelected: (wsId: WorkspaceId) => void
  ) {
    for (const wsId of initialWorkspaces) {
      this.addWorkspace(wsId);
    }
  }

  public addWorkspace(workspaceId: WorkspaceId): void {
    if (this.workspaces.has(workspaceId)) return;

    const label = this.labelOf(workspaceId);
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
      this.refresh();
    }
  }

  public getSelectedWorkspace(): WorkspaceId | undefined {
    return this.selectedWorkspaceId;
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

  private labelOf(workspaceId: WorkspaceId): string {
    const norm = wsToString(workspaceId).replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    return i < 0 ? norm : norm.slice(i + 1);
  }
}