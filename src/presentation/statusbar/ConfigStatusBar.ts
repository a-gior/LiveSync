import * as vscode from 'vscode';
import type { ConfigValidationResult } from '@infra/config/ConfigValidator';

/**
 * Status bar showing configuration state for all workspaces
 * 
 * Single-folder: Shows detailed status for that workspace
 * Multi-root: Shows aggregate status (e.g., "3/5 configured, 1 error")
 */
export class ConfigStatusBar {
  private item: vscode.StatusBarItem;
  private workspaceStatuses = new Map<string, ConfigValidationResult>();

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.name = 'LiveSync Config Status';
    this.item.command = 'livesync.configuration';
    this.updateDisplay();
    this.item.show();
  }

  /**
   * Update status for a specific workspace
   */
  updateWorkspaceStatus(
    workspaceId: string,
    result: ConfigValidationResult,
    hostname?: string,
    remotePath?: string
  ): void {
    this.workspaceStatuses.set(workspaceId, {
      ...result,
      // Store config details for later use
      _hostname: hostname,
      _remotePath: remotePath,
    } as any);

    this.updateDisplay();
  }

  /**
   * Remove a workspace (when folder is removed)
   */
  removeWorkspace(workspaceId: string): void {
    this.workspaceStatuses.delete(workspaceId);
    this.updateDisplay();
  }

  /**
   * Clear all workspace statuses
   */
  clear(): void {
    this.workspaceStatuses.clear();
    this.updateDisplay();
  }

  private updateDisplay(): void {
    const folders = vscode.workspace.workspaceFolders;
    
    if (!folders || folders.length === 0) {
      // No workspace open
      this.item.hide();
      return;
    }

    if (folders.length === 1) {
      // Single-folder workspace - show detailed status
      this.displaySingleFolder();
    } else {
      // Multi-root workspace - show aggregate status
      this.displayMultiRoot();
    }

    this.item.show();
  }

  private displaySingleFolder(): void {
    const folders = vscode.workspace.workspaceFolders!;
    const wsId = folders[0].uri.fsPath;
    const status = this.workspaceStatuses.get(wsId);

    if (!status) {
      this.item.text = '$(gear) LiveSync: Loading...';
      this.item.tooltip = 'Loading configuration';
      this.item.backgroundColor = undefined;
      return;
    }

    if (!status.hasConfig) {
      this.item.text = '$(gear) LiveSync: Not configured';
      this.item.tooltip = 'Click to configure LiveSync';
      this.item.backgroundColor = undefined;
    } else if (!status.isValid) {
      this.item.text = '$(error) LiveSync: Error';
      this.item.tooltip = status.error || 'Configuration error - click to fix';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      const hostname = (status as any)._hostname;
      const remotePath = (status as any)._remotePath;
      
      if (hostname && remotePath) {
        this.item.text = '$(cloud) LiveSync';
        this.item.tooltip = `Connected to ${hostname}:${remotePath}`;
      } else if (hostname) {
        this.item.text = '$(plug) LiveSync';
        this.item.tooltip = `Configured for ${hostname}`;
      } else {
        this.item.text = '$(plug) LiveSync';
        this.item.tooltip = 'Configured';
      }
      this.item.backgroundColor = undefined;
    }
  }

  private displayMultiRoot(): void {
    const folders = vscode.workspace.workspaceFolders!;
    const total = folders.length;
    
    let unconfigured = 0;
    let errors = 0;
    let configured = 0;

    for (const folder of folders) {
      const wsId = folder.uri.fsPath;
      const status = this.workspaceStatuses.get(wsId);

      if (!status) {
        continue; // Still loading
      }

      if (!status.hasConfig) {
        unconfigured++;
      } else if (!status.isValid) {
        errors++;
      } else {
        configured++;
      }
    }

    // Build status text and tooltip
    const parts: string[] = [];
    const tooltipParts: string[] = [];

    if (configured > 0) {
      parts.push(`${configured} configured`);
      tooltipParts.push(`${configured} workspace${configured > 1 ? 's' : ''} configured`);
    }

    if (unconfigured > 0) {
      parts.push(`${unconfigured} not configured`);
      tooltipParts.push(`${unconfigured} workspace${unconfigured > 1 ? 's' : ''} not configured`);
    }

    if (errors > 0) {
      parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
      tooltipParts.push(`${errors} workspace${errors > 1 ? 's' : ''} with errors`);
    }

    // Determine icon and background based on worst case
    let icon = '$(cloud)';
    let backgroundColor: vscode.ThemeColor | undefined = undefined;

    if (errors > 0) {
      icon = '$(error)';
      backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (unconfigured > 0) {
      icon = '$(gear)';
    } else if (configured > 0) {
      icon = '$(cloud)';
    }

    this.item.text = `${icon} LiveSync: ${parts.join(', ')}`;
    this.item.tooltip = `${total} workspace${total > 1 ? 's' : ''}\n${tooltipParts.join('\n')}\n\nClick to configure`;
    this.item.backgroundColor = backgroundColor;
  }

  dispose(): void {
    this.item.dispose();
  }
}