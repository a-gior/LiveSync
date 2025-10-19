import * as vscode from 'vscode';
import type { Services } from './services';

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

export function decidePresence(
  hasRemotes: boolean[],
  workspaceCount: number
): { supportsDownload: boolean; hint: string | undefined } {
  if (workspaceCount === 0) {
    return { supportsDownload: false, hint: undefined };
  }
  if (workspaceCount === 1) {
    const has = hasRemotes[0] ?? false;
    return { supportsDownload: has, hint: has ? undefined : 'local snapshot' };
  }
  const count = hasRemotes.filter(Boolean).length;
  const any = count > 0;
  return { supportsDownload: any, hint: any ? `${count}/${workspaceCount} remotes` : `${workspaceCount} workspaces` };
}