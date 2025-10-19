import * as vscode from 'vscode';
import type { DiffStatus } from '@domain/types';

/**
 * FileStatusDecorationProvider
 * Reads ?status=<diff-status> from the item's resourceUri query and applies a small badge + color.
 * Expected values: 'added' | 'removed' | 'modified' | 'unchanged' | 'conflict'
 */
export class FileStatusDecorationProvider implements vscode.FileDecorationProvider {
  private readonly byStatus = new Map<DiffStatus, vscode.FileDecoration>();

  constructor() {
    // Use VS Code's built-in git decoration theme colors for familiarity.
    this.byStatus.set('added', new vscode.FileDecoration(
      'A',
      'Added',
      new vscode.ThemeColor('gitDecoration.addedResourceForeground')
    ));

    this.byStatus.set('removed', new vscode.FileDecoration(
      'R',
      'Removed',
      new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
    ));

    this.byStatus.set('modified', new vscode.FileDecoration(
      'M',
      'Modified',
      new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
    ));

    this.byStatus.set('conflict', new vscode.FileDecoration(
      '!',
      'Conflict',
      new vscode.ThemeColor('gitDecoration.conflictingResourceForeground')
    ));

    // You can omit a decoration for 'unchanged' to keep the UI clean.
    // If you prefer to display something, uncomment below.
    this.byStatus.set('unchanged', new vscode.FileDecoration(
      'U',
      'Unchanged',
      new vscode.ThemeColor('foreground')
    ));

    // Do not propagate to children; we rely on your tree’s own aggregation.
    for (const deco of this.byStatus.values()) {
      deco.propagate = false;
    }
  }

  provideFileDecoration(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const status = getStatusFromUri(uri);
    if (!status) { return undefined; }
    return this.byStatus.get(status);
  }
}

/** Parse ?status=<value> out of the URI query and guard to DiffStatus. */
function getStatusFromUri(uri: vscode.Uri): DiffStatus | undefined {
  const q = uri.query || '';
  if (!q) { return undefined; }
  const params = new URLSearchParams(q);
  const raw = params.get('status');
  if (!raw) { return undefined; }

  // Narrow to our known statuses
  if (raw === 'added' || raw === 'removed' || raw === 'modified' || raw === 'unchanged' || raw === 'conflict') {
    return raw;
  }
  return undefined;
}
