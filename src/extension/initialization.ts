import * as vscode from 'vscode';

import { SyncStateManager } from '@app/SyncStateManager';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { StorageService } from '@infra/storage/StorageService';
import { ConfigErrorSuppressor } from '@infra/storage/ConfigErrorSuppressor';
import { initLoggingDeps } from '@infra/helpers/logging';
import { WorkspaceConfigService } from '../infrastructure/config/WorkspaceConfigService';
import { stringToWsId } from '../infrastructure/helpers/path';

/**
 * Initializes core infrastructure services:
 * - Storage and error suppression
 * - Logging dependencies
 * - Cache services (local and remote indexes)
 * - Workspace initialization (loads caches or triggers refresh)
 */
export async function initializeInfrastructure(
  context: vscode.ExtensionContext,
  state: SyncStateManager,
  config: WorkspaceConfigService
): Promise<{
  localCache: IndexCacheService;
  remoteCache: IndexCacheService;
}> {
  // Storage and error suppression
  const storage = new StorageService(context);
  const suppressor = new ConfigErrorSuppressor(storage);
  initLoggingDeps({ suppressor });

  // Cache services
  const localCache = new IndexCacheService('index.local.json');
  const remoteCache = new IndexCacheService('index.remote.json');

  // Initialize all workspaces (load from cache or trigger refresh)
  await initializeAllWorkspaces(state, localCache, remoteCache, config);

  return { localCache, remoteCache };
}

/**
 * Initialize all workspaces on extension activation
 */
export async function initializeAllWorkspaces(
  state: SyncStateManager,
  localCache: IndexCacheService,
  remoteCache: IndexCacheService,
  config: WorkspaceConfigService
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  
  console.log('[Initialization] ======== START ========');
  console.log('[Initialization] Processing', folders.length, 'workspace(s)');
  
  for (const folder of folders) {
    const wsId = stringToWsId(folder.uri.fsPath);
    console.log('[Initialization] --- Workspace:', wsId);
    
    const local = await localCache.load(wsId);
    const remote = await remoteCache.load(wsId);
    
    console.log('[Initialization] Cache status - local:', !!local, 'remote:', !!remote);
    
    if (local && remote) {
      // Cache exists - load it
      console.log('[Initialization] ✓ Loading from cache');
      state.runBatch(wsId, undefined as any, () => {
        state.setLocalIndex(wsId, local);
        state.setRemoteIndex(wsId, remote);
      });
    } else {
      console.log('[Initialization] ✗ No cache, checking config...');
      
      try {
        const eff = await config.get(folder);
        console.log('[Initialization] Config hasRemote:', eff.hasRemote);
        
        if (eff.hasRemote) {
          console.log('[Initialization] → Triggering refresh (no cache + valid config)');
          vscode.commands.executeCommand('livesync.experimental.refresh', folder);
        } else {
          console.log('[Initialization] → Skipping refresh (no valid config)');
        }
      } catch (err) {
        console.log('[Initialization] → Config load error, skipping refresh:', err);
      }
    }
  }
  
  console.log('[Initialization] ======== END ========');
}