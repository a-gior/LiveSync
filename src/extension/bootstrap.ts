import * as vscode from 'vscode';
import { DefaultDiffEngine } from '../domain/diff/DiffEngine';
import { SyncStateManager } from '../application/SyncStateManager';
import { ExperimentalTreeProvider } from '../presentation/tree/ExperimentalTreeProvider';
import { WorkspaceConfigService } from '../infrastructure/config/WorkspaceConfigService';
import { JsonSnapshotRemotePort } from '../infrastructure/remote/JsonSnapshotRemotePort';
import { SftpRemotePort } from '../infrastructure/remote/SftpRemotePort';
import { ChoosingRemotePort } from '../infrastructure/remote/ChoosingRemotePort';
import type { RemotePort } from '../application/ports/RemotePort';
import { FolderStateStore } from '../presentation/tree/FolderStateStore';
import { ProgressService } from '../presentation/statusbar/ProgressService';
import type { Services } from './services';

export async function bootstrap(context: vscode.ExtensionContext): Promise<Services> {
  const diffEngine = new DefaultDiffEngine();
  const state = new SyncStateManager(diffEngine);

  const config = new WorkspaceConfigService(context);
  const jsonRemote = new JsonSnapshotRemotePort();
  const sftpRemote = new SftpRemotePort(config, 4);
  const remote: RemotePort = new ChoosingRemotePort(config, sftpRemote, jsonRemote);

  const folderState = new FolderStateStore(context.workspaceState);

  const workspaceIds = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  const provider = new ExperimentalTreeProvider(state, workspaceIds, folderState);

  const treeView = vscode.window.createTreeView('livesyncExperimental', { treeDataProvider: provider });

  const progress = new ProgressService();
  context.subscriptions.push({ dispose: () => progress.dispose() });
  context.subscriptions.push(treeView);

  return { context, diffEngine, state, config, remote, provider, treeView, progress };
}
