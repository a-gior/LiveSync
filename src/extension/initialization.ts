import * as vscode from 'vscode';

import { SyncStateManager } from '@app/SyncStateManager';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { StorageService } from '@infra/storage/StorageService';
import { ConfigErrorSuppressor } from '@infra/storage/ConfigErrorSuppressor';
import { initLoggingDeps, logStartup, logOperation, logCache, logInfoMessage } from '@helpers/logging';
import { stringToWsId } from '@infra/helpers/path';
import { ConfigValidator } from '../infrastructure/config/ConfigValidator';

export async function initializeInfrastructure(
  context: vscode.ExtensionContext,
  state: SyncStateManager,
  validator: ConfigValidator
): Promise<{
  localCache: IndexCacheService;
  remoteCache: IndexCacheService;
}> {
  
  const storage = new StorageService(context);
  const suppressor = new ConfigErrorSuppressor(storage);
  initLoggingDeps({ suppressor });

  const localCache = new IndexCacheService('index.local.json');
  const remoteCache = new IndexCacheService('index.remote.json');

  await initializeAllWorkspaces(state, localCache, remoteCache, validator);

  return { localCache, remoteCache };
}

async function initializeAllWorkspaces(
  state: SyncStateManager,
  localCache: IndexCacheService,
  remoteCache: IndexCacheService,
  validator: ConfigValidator
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
      const validationResult = validator.getCached(wsId);
      
      if (validationResult.isValid && validationResult.hasConfig) {
        logOperation(wsId, 'refresh', 'no cache - triggering initial sync');
        vscode.commands.executeCommand('livesync.refresh', folder);
      } else {
        const reason = validationResult.error || 'no valid configuration';
        logOperation(wsId, 'skipped', reason);
      }
    }
  }
  
  logStartup('Workspace initialization complete');
}