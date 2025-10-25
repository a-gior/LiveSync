import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import { resolveEntryTarget } from '@helpers/resolve';
import { stringToRel, stringToWsId } from '@helpers/path';

export function registerViewCommands(services: Services): void {
  const { context, provider, treeView } = services;

  // Focus the LiveSync view
  cmd(context, 'livesync.focusExperimentalView', async (arg?: unknown) => {
    const target = resolveEntryTarget(arg, { allowActiveEditor: true });
    if (target?.workspaceId) {
      provider.setCurrentWorkspace(stringToWsId(target.workspaceId));
    }
    await vscode.commands.executeCommand('livesync.diffs.focus');
  });

  // React to settings changes that affect the tree filter/appearance
  const confDisp = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('livesync.view.showUnchanged') ||
        e.affectsConfiguration('livesync.view.recentlyResolvedRetentionMs')) {
      provider.updateViewConfig();
    }
    
    if (e.affectsConfiguration('livesync.view.showAsTree')) {
      const cfg = vscode.workspace.getConfiguration('livesync');
      const showAsTree = cfg.get<boolean>('view.showAsTree') ?? true;
      provider.setShowAsTree(showAsTree);
      vscode.commands.executeCommand('setContext', 'livesyncViewMode', showAsTree ? 'tree' : 'list');
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