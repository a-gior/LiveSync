import * as vscode from 'vscode';
import { cmd } from '../cmd';
import type { Services } from '../services';
import { stringToRel, stringToWsId } from '@helpers/path';

export function registerViewCommands(services: Services): void {
  const { context, provider, treeView } = services;

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

  // Open file from the view
  cmd(context, 'livesync.openFile', async (filePath: string) => {
    const uri = vscode.Uri.file(filePath);
    vscode.window.showTextDocument(uri, { preview: true });
  });

}