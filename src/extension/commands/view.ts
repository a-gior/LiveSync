import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import { resolveEntryTarget } from '../../infrastructure/helpers/resolve';
import { stringToRel, stringToWsId } from '../../infrastructure/helpers/path';

export function registerViewCommands(services: Services): void {
  const { context, provider, treeView } = services;

  // Focus the LiveSync view:
  // - If invoked with a Tree/Explorer/Editor context, focus THAT workspace.
  // - Otherwise, focus the first workspace.
  cmd(context, 'livesync.focusExperimentalView', async (arg?: unknown) => {
    // Prefer explicit target from arg; else first workspace
    const target = resolveEntryTarget(arg, { allowActiveEditor: true });
    const fallbackWs = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? undefined;
    const workspaceId = target?.workspaceId ?? fallbackWs;

    if (!workspaceId) {
      return;
    }

    const rootNode = provider.getWorkspaceNode(stringToWsId(workspaceId));
    if (!rootNode) {
      return;
    }

    await treeView.reveal(rootNode, { expand: true, select: false });
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
