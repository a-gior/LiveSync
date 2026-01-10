// File: src/presentation/tree/WorkspaceListProvider.ts
// Event-driven version - subscribes to validator events

import * as vscode from 'vscode';
import { WorkspaceId } from '../../domain/types';
import { basenameRel } from '../../infrastructure/helpers/path';
import type { ConfigValidator } from '@infra/config/ConfigValidator';

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
  private subscription: vscode.Disposable;

  constructor(
    initialWorkspaces: WorkspaceId[],
    private readonly onWorkspaceSelected: (wsId: WorkspaceId) => void,
    private readonly state: vscode.Memento | undefined,
    validator: ConfigValidator
  ) {
    for (const wsId of initialWorkspaces) {
      this.addWorkspace(wsId);
    }

    // Subscribe to validation changes
    this.subscription = validator.onValidationChanged(event => {
      this.handleValidationChanged(event);
    });
  }

  /**
   * Handle validation changed event
   */
  private handleValidationChanged(event: { workspaceId: WorkspaceId; result: { hasConfig: boolean; isValid: boolean } }): void {
    const node = this.workspaces.get(event.workspaceId);
    if (node) {
      node.hasConfig = event.result.hasConfig;
      node.configValid = event.result.isValid;
      this.refresh();
    }
  }

  public addWorkspace(workspaceId: WorkspaceId): void {
    if (this.workspaces.has(workspaceId)) {return;}

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

  /**
   * Manual update for backward compatibility (optional - events are preferred)
   */
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

  public restoreSelection(): WorkspaceId | undefined {
    if (!this.state) {
      // No state available - select first workspace if available
      const first = Array.from(this.workspaces.keys())[0];
      if (first) {
        this.selectWorkspace(first);
      }
      return first;
    }

    const savedId = this.state.get<WorkspaceId>(SELECTED_WORKSPACE_KEY);

    if (savedId && this.workspaces.has(savedId)) {
      this.selectWorkspace(savedId);
      return savedId;
    } else {
      // Saved workspace no longer exists - select first available
      const first = Array.from(this.workspaces.keys())[0];
      if (first) {
        this.selectWorkspace(first);
      }
      return first;
    }
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

  getTreeItem(node: WorkspaceNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label);
    item.contextValue = 'workspace';

    // Icon based on config status
    if (!node.hasConfig) {
      item.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('errorForeground'));
      item.tooltip = `${node.label}: No configuration`;
    } else if (node.configValid) {
      item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
      item.tooltip = `${node.label}: Connected`;
    } else {
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
      item.tooltip = `${node.label}: Configuration error`;
    }

    // Highlight selected workspace
    if (node.workspaceId === this.selectedWorkspaceId) {
      item.description = '(current)';
    }

    item.command = {
      command: 'livesync.selectWorkspace',
      title: 'Select Workspace',
      arguments: [node.workspaceId],
    };

    return item;
  }

  getChildren(): WorkspaceNode[] {
    return Array.from(this.workspaces.values());
  }

  private refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}