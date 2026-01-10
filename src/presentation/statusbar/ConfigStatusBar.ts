// File: src/presentation/statusbar/ConfigStatusBar.ts
// Event-driven version with rich markdown tooltips

import * as vscode from 'vscode';
import type { ConfigValidator, ValidationChangedEvent } from '@infra/config/ConfigValidator';

/**
 * Status bar showing configuration state for all workspaces
 * Automatically updates via event subscription
 * 
 * Single-folder: Shows icon + connection details
 * Multi-root: Shows aggregate counts with icons (e.g., "✓ 3 / ⚠ 1 / ✗ 2")
 */
export class ConfigStatusBar {
  private item: vscode.StatusBarItem;
  private workspaceStatuses = new Map<string, ValidationChangedEvent>();
  private subscription: vscode.Disposable;

  constructor(validator: ConfigValidator) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.name = 'LiveSync Config Status';
    this.item.command = 'livesync.configuration';
    
    // Subscribe to validation changes
    this.subscription = validator.onValidationChanged(event => {
      this.handleValidationChanged(event);
    });
    
    this.updateDisplay();
    this.item.show();
  }

  /**
   * Handle validation changed event
   */
  private handleValidationChanged(event: ValidationChangedEvent): void {
    this.workspaceStatuses.set(event.workspaceId, event);
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
      this.item.hide();
      return;
    }

    if (folders.length === 1) {
      this.displaySingleFolder();
    } else {
      this.displayMultiRoot();
    }

    this.item.show();
  }

  private displaySingleFolder(): void {
    const folders = vscode.workspace.workspaceFolders!;
    const wsId = folders[0].uri.fsPath;
    const status = this.workspaceStatuses.get(wsId);

    if (!status) {
      this.item.text = '$(loading~spin) LiveSync';
      this.item.tooltip = 'Loading configuration...';
      this.item.backgroundColor = undefined;
      return;
    }

    if (!status.result.hasConfig) {
      this.item.text = '$(warning) LiveSync';
      this.item.tooltip = 'No configuration found\n\nClick to configure LiveSync';
      this.item.backgroundColor = undefined;
    } else if (!status.result.isValid) {
      this.item.text = '$(error) LiveSync';
      const tooltip = new vscode.MarkdownString(
        `**Configuration Error**\n\n${status.result.error || 'Invalid configuration'}\n\n*Click to fix configuration*`
      );
      tooltip.supportThemeIcons = true;
      this.item.tooltip = tooltip;
      this.item.backgroundColor = undefined;
    } else {
      const hostname = status.hostname;
      const remotePath = status.remotePath;
      
      this.item.text = '$(check) LiveSync';
      
      if (hostname && remotePath) {
        const tooltip = new vscode.MarkdownString(
          `**LiveSync Connected**\n\n` +
          `• **Host:** \`${hostname}\`\n\n` +
          `• **Remote:** \`${remotePath}\`\n\n` +
          `*Click to modify configuration*`
        );
        tooltip.supportThemeIcons = true;
        this.item.tooltip = tooltip;
      } else {
        this.item.tooltip = 'LiveSync configured\n\nClick to view configuration';
      }
      this.item.backgroundColor = undefined;
    }
  }

  private displayMultiRoot(): void {
    const folders = vscode.workspace.workspaceFolders!;
    
    let configured = 0;
    let unconfigured = 0;
    let errors = 0;

    const configuredList: Array<{ label: string; host?: string; remote?: string }> = [];
    const unconfiguredList: string[] = [];
    const errorList: Array<{ label: string; error: string }> = [];

    for (const folder of folders) {
      const wsId = folder.uri.fsPath;
      const status = this.workspaceStatuses.get(wsId);

      if (!status) {
        continue;
      }

      const label = status.label || folder.name;

      if (!status.result.hasConfig) {
        unconfigured++;
        unconfiguredList.push(label);
      } else if (!status.result.isValid) {
        errors++;
        const errorMsg = status.result.error || 'Invalid';
        errorList.push({ label, error: errorMsg });
      } else {
        configured++;
        const host = status.hostname;
        const remote = status.remotePath;
        configuredList.push({ label, host, remote });
      }
    }

    // Build compact status text with icons
    const parts: string[] = [];
    if (configured > 0) {
      parts.push(`$(check) ${configured}`);
    }
    if (unconfigured > 0) {
      parts.push(`$(warning) ${unconfigured}`);
    }
    if (errors > 0) {
      parts.push(`$(error) ${errors}`);
    }

    this.item.text = parts.length > 0 ? parts.join(' ') : 'LiveSync $(loading~spin)';

    // Build detailed tooltip with better formatting
    const tooltipParts: string[] = [];
    
    // Title with separator
    tooltipParts.push('## LiveSync Workspaces');
    tooltipParts.push('---');
    tooltipParts.push('');

    if (configured > 0) {
      tooltipParts.push('### $(check) Configured');
      tooltipParts.push('');
      for (const ws of configuredList) {
        tooltipParts.push(`**${ws.label}**`);
        if (ws.host && ws.remote) {
          tooltipParts.push(`- Host: \`${ws.host}\``);
          tooltipParts.push(`- Remote: \`${ws.remote}\``);
        }
        tooltipParts.push('');
      }
    }

    if (unconfigured > 0) {
      if (configured > 0) {
        tooltipParts.push('---');
        tooltipParts.push('');
      }
      tooltipParts.push('### $(warning) Not Configured');
      tooltipParts.push('');
      for (const ws of unconfiguredList) {
        tooltipParts.push(`**${ws}**`);
      }
      tooltipParts.push('');
    }

    if (errors > 0) {
      if (configured > 0 || unconfigured > 0) {
        tooltipParts.push('---');
        tooltipParts.push('');
      }
      tooltipParts.push('### $(error) Errors');
      tooltipParts.push('');
      for (const ws of errorList) {
        tooltipParts.push(`**${ws.label}**`);
        tooltipParts.push(`- ${ws.error}`);
        tooltipParts.push('');
      }
    }

    tooltipParts.push('---');
    tooltipParts.push('');
    tooltipParts.push('*Click to configure workspaces*');

    const tooltip = new vscode.MarkdownString(tooltipParts.join('\n'));
    tooltip.supportThemeIcons = true;
    this.item.tooltip = tooltip;
    this.item.backgroundColor = undefined;
  }

  dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }
}