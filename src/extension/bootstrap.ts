import * as vscode from 'vscode';
import { DefaultDiffEngine } from '../domain/diff/DiffEngine';
import { SyncStateManager } from '../application/SyncStateManager';
import { ExperimentalTreeProvider } from '../presentation/tree/ExperimentalTreeProvider';
import { WorkspaceConfigService } from '../infrastructure/config/WorkspaceConfigService';
import { SftpRemotePort } from '../infrastructure/remote/SftpRemotePort';
import { ChoosingRemotePort } from '../infrastructure/remote/ChoosingRemotePort';
import type { RemotePort } from '../application/ports/RemotePort';
import { FolderStateStore } from '../presentation/tree/FolderStateStore';
import { ProgressService } from '../presentation/statusbar/ProgressService';
import type { Services } from './services';
import { IndexCacheService } from '../infrastructure/persistence/IndexCacheService';
import { StorageService } from '../infrastructure/storage/StorageService';
import { ConfigErrorSuppressor } from '../infrastructure/storage/ConfigErrorSuppressor';
import { initLoggingDeps } from '../infrastructure/helpers/logging';
import { stringToWsId } from '../infrastructure/helpers/path';

export async function bootstrap(context: vscode.ExtensionContext): Promise<Services> {
  const diffEngine = new DefaultDiffEngine();
  const state = new SyncStateManager(diffEngine);

  const config = new WorkspaceConfigService(context);
  const sftpRemote = new SftpRemotePort(config, 4);
  const remote: RemotePort = new ChoosingRemotePort(config, sftpRemote);

  const folderState = new FolderStateStore(context.workspaceState);

  // If you have a WorkspaceId brand, use it here:
  const workspaceIds = (vscode.workspace.workspaceFolders ?? []).map(f => stringToWsId(f.uri.fsPath));

  const provider = new ExperimentalTreeProvider(state, workspaceIds, folderState);
  const treeView = vscode.window.createTreeView('livesyncExperimental', { treeDataProvider: provider });

  const localCache  = new IndexCacheService('index.local.json');
  const remoteCache = new IndexCacheService('index.remote.json');

  const storage = new StorageService(context);
  const suppressor = new ConfigErrorSuppressor(storage);
  initLoggingDeps({ suppressor });

  for (const ws of workspaceIds) {
    const local  = await localCache.load(ws);
    const remote = await remoteCache.load(ws);
    if (local || remote) {
      state.runBatch(ws, undefined as any, () => {
        if (local)  { state.setLocalIndex(ws,  local); }
        if (remote) { state.setRemoteIndex(ws, remote); }
      });
    }
  }

  // Live-apply view settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('livesync.view')) { provider.updateViewConfig(); }
    })
  );

  const progress = new ProgressService();
  context.subscriptions.push(
    { dispose: () => progress.dispose() },
    { dispose: () => provider.dispose() },
    treeView
  );
  context.subscriptions.push(treeView);



  return { context, diffEngine, state, config, remote, provider, treeView, progress, localCache, remoteCache, suppressor };
}

