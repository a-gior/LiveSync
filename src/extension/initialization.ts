// Add this to your bootstrap.ts or create a new file: src/extension/initialization.ts

import * as vscode from 'vscode';
import { WorkspaceId } from '@domain/types';
import { SyncStateManager } from '@app/SyncStateManager';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';

/**
 * Initialize all workspaces on extension activation
 */
export async function initializeAllWorkspaces(
  state: SyncStateManager,
  localCache: IndexCacheService,
  remoteCache: IndexCacheService
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  
    for (const folder of folders) {
        const wsId = folder.uri.fsPath as WorkspaceId;
        const local  = await localCache.load(wsId);
        const remote = await remoteCache.load(wsId);
        
        if (local && remote) {
            // Cache exists - load it
            state.runBatch(wsId, undefined as any, () => {
            state.setLocalIndex(wsId, local);
            state.setRemoteIndex(wsId, remote);
            });
        } else {
            // No cache - trigger refresh to build indexes
            const folder = vscode.workspace.workspaceFolders?.find(f => f.uri.fsPath === wsId);
            if (folder) {
                // Don't await - let it run in background
                vscode.commands.executeCommand('livesync.experimental.refresh', folder);
            }
        }
    }
}