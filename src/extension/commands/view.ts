import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import { resolveEntryTarget } from '../../infrastructure/helpers/resolve';
import { stringToRel, stringToWsId } from '../../infrastructure/helpers/path';

export function registerViewCommands(services: Services): void {
  const { context, provider, treeView } = services;

  // Focus the LiveSync view:
  // - If invoked with a Tree/Explorer/Editor context, switch to THAT workspace.
  // - Otherwise, just focus the view (no need to reveal specific nodes)
  cmd(context, 'livesync.focusExperimentalView', async (arg?: unknown) => {
    // If there's a specific target, switch to that workspace
    const target = resolveEntryTarget(arg, { allowActiveEditor: true });
    if (target?.workspaceId) {
      provider.setCurrentWorkspace(stringToWsId(target.workspaceId));
    }

    // Simply focus the tree view - no need to reveal specific nodes
    // VS Code will automatically show the tree content
    await vscode.commands.executeCommand('livesync.diffs.focus');
  });

  // React to settings changes that affect the tree filter/appearance
  const confDisp = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('livesync.view.showUnchanged') ||
      e.affectsConfiguration('livesync.view.recentlyResolvedRetentionMs')
    ) {
      provider.updateViewConfig();
    }
  });
  context.subscriptions.push(confDisp);

  // Persist expand/collapse state per folder entry
  const expandDisp = treeView.onDidExpandElement((e) => {
    const node: any = e.element;
    if (node && node.kind === 'entry') {
      provider.folderStateStore?.setOpen(stringToWsId(node.workspaceId), stringToRel(node.path), true);
    }
  });
  const collapseDisp = treeView.onDidCollapseElement((e) => {
    const node: any = e.element;
    if (node && node.kind === 'entry') {
      provider.folderStateStore?.setOpen(stringToWsId(node.workspaceId), stringToRel(node.path), false);
    }
  });
  context.subscriptions.push(expandDisp, collapseDisp);
}