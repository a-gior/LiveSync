import * as vscode from 'vscode';
import type { Services } from './services';
import { decidePresence } from './remotePresence.logic';

export function registerRemotePresence(services: Services): void {
  const { config, progress } = services;

  async function recompute(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const has: boolean[] = [];

    for (const f of folders) {
      const eff = await config.get(f);
      has.push(!!eff.hasRemote);
    }

    const { supportsDownload, hint } = decidePresence(has, folders.length);

    await vscode.commands.executeCommand('setContext', 'livesync.supportsDownload', supportsDownload);
    progress?.setRemoteHint?.(hint);
  }

  recompute().catch(() => undefined);
  services.context.subscriptions.push(
    config.onDidChange(() => { recompute().catch(() => undefined); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { recompute().catch(() => undefined); })
  );
}
