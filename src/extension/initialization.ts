import * as vscode from 'vscode';

import { SyncStateManager } from '@app/SyncStateManager';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { StorageService } from '@infra/storage/StorageService';
import { ConfigErrorSuppressor } from '@infra/storage/ConfigErrorSuppressor';
import { initLoggingDeps, logStartup, logOperation, logCache } from '@helpers/logging';
import { stringToWsId } from '@infra/helpers/path';
import { ConfigValidator } from '../infrastructure/config/ConfigValidator';

export async function initializeInfrastructure(
  context: vscode.ExtensionContext,
  state: SyncStateManager,
  validator: ConfigValidator
): Promise<{
  localCache: IndexCacheService;
  remoteCache: IndexCacheService;
  baseCache: IndexCacheService;
}> {
  
  const storage = new StorageService(context);
  const suppressor = new ConfigErrorSuppressor(storage);
  initLoggingDeps({ suppressor });

  const localCache = new IndexCacheService('index.local.json');
  const remoteCache = new IndexCacheService('index.remote.json');
  const baseCache = new IndexCacheService('index.base.json');

  await initializeAllWorkspaces(state, localCache, remoteCache, baseCache, validator);

  return { localCache, remoteCache, baseCache };
}

async function initializeAllWorkspaces(
  state: SyncStateManager,
  localCache: IndexCacheService,
  remoteCache: IndexCacheService,
  baseCache: IndexCacheService,
  validator: ConfigValidator
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  
  logStartup(`Initializing ${folders.length} workspace(s)`);
  
  for (const folder of folders) {
    const wsId = stringToWsId(folder.uri.fsPath);
    
    // Load all three snapshots from cache
    const local = await localCache.load(wsId);
    const remote = await remoteCache.load(wsId);
    const base = await baseCache.load(wsId);
    
    if (local && remote) {
      logCache(wsId, 'loaded', 'restoring indexes from cache');
      
      state.runBatch(wsId, undefined as any, () => {
        // Set local and remote
        state.setLocalIndex(wsId, local);
        state.setRemoteIndex(wsId, remote);
        
        // Set base (or initialize on first run/migration)
        if (base && base.size > 0) {
          // Use persisted base from cache
          logCache(wsId, 'loaded', 'restoring base snapshot from cache');
          state.setBaseIndex(wsId, base);
        } else {
          // First run or migration: empty base
          logCache(wsId, 'initialized', 'base snapshot empty (first run - please review all files)');
          state.setBaseIndex(wsId, new Map());
        }
      });
    } else {
      // No cache - need to fetch fresh
      const validationResult = await validator.getCached(wsId, false);
      
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