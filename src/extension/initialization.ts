import * as vscode from 'vscode';

import { SyncStateManager } from '@app/SyncStateManager';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { StorageService } from '@infra/storage/StorageService';
import { ConfigErrorSuppressor } from '@infra/storage/ConfigErrorSuppressor';
import { initLoggingDeps, logStartup, logOperation, logCache } from '@helpers/logging';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { stringToWsId } from '@infra/helpers/path';

export async function initializeInfrastructure(
  context: vscode.ExtensionContext,
  state: SyncStateManager,
  config: WorkspaceConfigService
): Promise<{
  localCache: IndexCacheService;
  remoteCache: IndexCacheService;
}> {
  const storage = new StorageService(context);
  const suppressor = new ConfigErrorSuppressor(storage);
  initLoggingDeps({ suppressor });

  const localCache = new IndexCacheService('index.local.json');
  const remoteCache = new IndexCacheService('index.remote.json');

  await initializeAllWorkspaces(state, localCache, remoteCache, config);

  return { localCache, remoteCache };
}

export async function initializeAllWorkspaces(
  state: SyncStateManager,
  localCache: IndexCacheService,
  remoteCache: IndexCacheService,
  config: WorkspaceConfigService
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  
  logStartup(`Initializing ${folders.length} workspace(s)`);
  
  for (const folder of folders) {
    const wsId = stringToWsId(folder.uri.fsPath);
    
    const local = await localCache.load(wsId);
    const remote = await remoteCache.load(wsId);
    
    if (local && remote) {
      logCache(wsId, 'loaded', 'restoring indexes from cache');
      state.runBatch(wsId, undefined as any, () => {
        state.setLocalIndex(wsId, local);
        state.setRemoteIndex(wsId, remote);
      });
    } else {
      try {
        const eff = await config.get(folder);
        
        if (eff.hasRemote) {
          logOperation(wsId, 'refresh', 'no cache - triggering initial sync');
          vscode.commands.executeCommand('livesync.refresh', folder);
        } else {
          logOperation(wsId, 'skipped', 'no valid remote configuration');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'unknown error';
        logOperation(wsId, 'error', `failed to load configuration: ${errMsg}`);
      }
    }
  }
  
  logStartup('Workspace initialization complete');
}