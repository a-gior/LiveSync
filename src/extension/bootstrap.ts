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
import { WorkspaceListProvider } from '../presentation/tree/WorkspaceListProvider';
import { WorkspaceId } from '../domain/types';
import { ConfigValidator } from '../infrastructure/config/ConfigValidator';
import { initializeAllWorkspaces } from './initialization';

export async function bootstrap(context: vscode.ExtensionContext): Promise<Services> {
  const diffEngine = new DefaultDiffEngine();
  const state = new SyncStateManager(diffEngine);

  const config = new WorkspaceConfigService(context);
  const configValidator = new ConfigValidator(config);

  const validationResults = await configValidator.validateAll();

  const sftpRemote = new SftpRemotePort(config, 4);
  const remote: RemotePort = new ChoosingRemotePort(config, sftpRemote);

  const folderState = new FolderStateStore(context.workspaceState);

  // If you have a WorkspaceId brand, use it here:
  const workspaceIds = (vscode.workspace.workspaceFolders ?? []).map(f => stringToWsId(f.uri.fsPath));
  const isMultiRoot = workspaceIds.length > 1;

  // Set context for conditional view visibility
  await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', isMultiRoot);

  let workspaceListProvider: WorkspaceListProvider | undefined;
  let workspaceListView: vscode.TreeView<any> | undefined;

  // Create diffs view (always)
  const initialWorkspace = workspaceIds[0];
  const provider = new ExperimentalTreeProvider(state, initialWorkspace, folderState);
  const treeView = vscode.window.createTreeView('livesync.diffs', { 
    treeDataProvider: provider 
  });

  const localCache  = new IndexCacheService('index.local.json');
  const remoteCache = new IndexCacheService('index.remote.json');

  const storage = new StorageService(context);
  const suppressor = new ConfigErrorSuppressor(storage);
  initLoggingDeps({ suppressor });

  await initializeAllWorkspaces(state, localCache, remoteCache);
  
  // Create workspace list view if multi-root
  if (isMultiRoot) {
    workspaceListProvider = new WorkspaceListProvider(
      workspaceIds,
      (selectedWsId) => {
        // When a workspace is selected, switch the diffs view to that workspace
        provider.setCurrentWorkspace(selectedWsId);
      }
    );

    workspaceListView = vscode.window.createTreeView('livesync.workspaces', {
      treeDataProvider: workspaceListProvider,
      showCollapseAll: false,
    });

    // Select first workspace by default
    if (workspaceIds.length > 0) {
      workspaceListProvider.selectWorkspace(workspaceIds[0]);
    }
  }
  
  // Update workspace list with config status (if multi-root)
  if (workspaceListProvider) {
    for (const result of validationResults) {
      workspaceListProvider.updateConfigStatus(
        result.workspaceId,
        result.hasConfig,
        result.isValid
      );
    }
  }

  // Re-validate when config changes
  context.subscriptions.push(
    config.onDidChange(async () => {
      const results = await configValidator.validateAll();
      
      if (workspaceListProvider) {
        for (const result of results) {
          workspaceListProvider.updateConfigStatus(
            result.workspaceId,
            result.hasConfig,
            result.isValid
          );
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.selectWorkspace', (wsId: WorkspaceId) => {
      workspaceListProvider?.selectWorkspace(wsId);
    })
  );

  // Live-apply view settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('livesync.view')) { provider.updateViewConfig(); }
    })
  );

  // Listen for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      for (const folder of event.added) {
        const wsId = stringToWsId(folder.uri.fsPath);
        workspaceListProvider?.addWorkspace(wsId);
        
        // Load caches
        const local  = await localCache.load(wsId);
        const remote = await remoteCache.load(wsId);
        if (local || remote) {
          state.runBatch(wsId, undefined as any, () => {
            if (local)  { state.setLocalIndex(wsId,  local); }
            if (remote) { state.setRemoteIndex(wsId, remote); }
          });
        }
      }

      for (const folder of event.removed) {
        const wsId = stringToWsId(folder.uri.fsPath);
        workspaceListProvider?.removeWorkspace(wsId);
      }

      // Update multi-root context
      const newIsMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', newIsMultiRoot);
    })
  );

  if (workspaceListView) {
    context.subscriptions.push(workspaceListView);
  }

  const progress = new ProgressService();
  context.subscriptions.push(
    { dispose: () => progress.dispose() },
    { dispose: () => provider.dispose() },
    treeView
  );
  context.subscriptions.push(treeView);

  // Initial refresh
  setTimeout(() => {
    provider.refreshAll();
  }, 100);

  return { context, diffEngine, state, config, remote, provider, treeView, workspaceListProvider, progress, localCache, remoteCache, suppressor };
}

