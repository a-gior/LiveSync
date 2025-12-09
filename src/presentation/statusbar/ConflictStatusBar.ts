// src/presentation/statusbar/ConflictStatusBar.ts - REFACTORED
// Event-driven version that subscribes to SyncStateManager

import * as vscode from 'vscode';
import { SyncStateManager } from '@app/SyncStateManager';

/**
 * Status bar for showing conflict count with detailed hover tooltip
 * Subscribes to SyncStateManager conflict events for automatic updates
 */
export class ConflictStatusBar {
  private item: vscode.StatusBarItem;
  private unsubscribe?: () => void;

  constructor(private readonly state: SyncStateManager) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    this.item.name = 'LiveSync Conflicts';
    this.item.command = 'livesync.focusTree';
    this.item.hide();

    // Subscribe to conflict changes from SyncStateManager
    this.unsubscribe = state.subscribeToConflictChanges(() => {
      this.update();
    });

    // Initial update
    this.update();
  }

  /**
   * Update status bar display based on current state
   */
  private update(): void {
    const conflicts = this.state.getAllConflicts();
    const count = conflicts.length;

    if (count === 0) {
      this.item.hide();
      return;
    }

    // Show count with warning icon
    this.item.text = `$(warning) ${count} conflict${count > 1 ? 's' : ''}`;

    // Build detailed tooltip
    const tooltipParts: string[] = [];
    tooltipParts.push('## LiveSync Conflicts');
    tooltipParts.push('---');
    tooltipParts.push('');

    // Group by type
    const remoteModified = conflicts.filter(c => c.type === 'remote-modified');
    const localModified = conflicts.filter(c => c.type === 'local-modified');

    if (remoteModified.length > 0) {
      tooltipParts.push('### $(cloud) Remote Modified');
      tooltipParts.push('');
      for (const info of remoteModified.slice(0, 10)) {
        tooltipParts.push(`- \`${info.relPath}\``);
      }
      if (remoteModified.length > 10) {
        tooltipParts.push(`- *...and ${remoteModified.length - 10} more*`);
      }
      tooltipParts.push('');
    }

    if (localModified.length > 0) {
      if (remoteModified.length > 0) {
        tooltipParts.push('---');
        tooltipParts.push('');
      }
      tooltipParts.push('### $(file) Local Modified');
      tooltipParts.push('');
      for (const info of localModified.slice(0, 10)) {
        tooltipParts.push(`- \`${info.relPath}\``);
      }
      if (localModified.length > 10) {
        tooltipParts.push(`- *...and ${localModified.length - 10} more*`);
      }
      tooltipParts.push('');
    }

    tooltipParts.push('---');
    tooltipParts.push('');
    tooltipParts.push('*Click to view in LiveSync tree*');

    const tooltip = new vscode.MarkdownString(tooltipParts.join('\n'));
    tooltip.supportThemeIcons = true;
    this.item.tooltip = tooltip;
    this.item.show();
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    this.item.dispose();
  }
}