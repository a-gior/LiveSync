import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';

export function registerViewCommands(services: Services) {
  const { context, provider, treeView } = services;

  cmd(context, 'livesync.focusExperimentalView', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) { return; }
    const wsId = folders[0].uri.fsPath;
    const rootNode = provider.getWorkspaceNode(wsId);
    if (!rootNode) { return; }
    await treeView.reveal(rootNode, { expand: true, select: false });
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('livesync.view.showUnchanged') ||
        e.affectsConfiguration('livesync.view.recentlyResolvedRetentionMs')
      ) {
        provider.updateViewConfig();
      }
    })
  );

  // Persist expand/collapse
  treeView.onDidExpandElement((e) => {
    const node: any = e.element;
    if (node.kind === 'entry') { provider.folderStateStore?.setOpen(node.workspaceId, node.path, true); }
  });
  treeView.onDidCollapseElement((e) => {
    const node: any = e.element;
    if (node.kind === 'entry') { provider.folderStateStore?.setOpen(node.workspaceId, node.path, false); }
  });
}
