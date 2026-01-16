import type { SyncStateManager } from '@app/SyncStateManager';
import type { IndexCacheService } from '@infra/persistence/IndexCacheService';
import type { WorkspaceId } from '@domain/types';
import { ConfigValidator } from '../config/ConfigValidator';

/**
 * Listens to SyncStateManager diff changes and automatically persists
 * local/remote indexes to disk with debouncing to avoid excessive writes.
 */
export class DebouncedCachePersister {
  private pendingWorkspaces = new Set<WorkspaceId>();
  private saveTimer?: NodeJS.Timeout;
  private readonly debounceMs: number;

  constructor(
    private readonly state: SyncStateManager,
    private readonly localCache: IndexCacheService,
    private readonly remoteCache: IndexCacheService,
    private readonly baseCache: IndexCacheService,
    private readonly validator: ConfigValidator,
    debounceMs: number = 1000
  ) {
    this.debounceMs = debounceMs;
    
    // Subscribe to all state changes
    state.subscribeToDiffChanges((event) => {
      this.pendingWorkspaces.add(event.workspaceId);
      this.scheduleSave();
    });
  }

  /**
   * Schedule a debounced save. Each call resets the timer.
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /**
   * Immediately flush all pending workspace caches to disk.
   */
  private async flush(): Promise<void> {
    const workspaces = Array.from(this.pendingWorkspaces);
    this.pendingWorkspaces.clear();

    if (workspaces.length === 0) {return;}

    await Promise.allSettled(
      workspaces.map(async (ws) => {
        try {
          const validation = await this.validator.getCached(ws, false);
          if (!validation.hasConfig) {
            return; // Skip - no config, don't create .livesync
          }

          const local = this.state.getLocalIndex(ws);
          const remote = this.state.getRemoteIndex(ws);
          const base = this.state.getBaseIndex(ws);  
          
          await Promise.all([
            this.localCache.save(ws, local),
            this.remoteCache.save(ws, remote),
            this.baseCache.save(ws, base)  
          ]);
        } catch (err) {
          console.error(`[DebouncedCachePersister] Failed to persist cache for ${ws}:`, err);
        }
      })
    );
  }

  /**
   * Force an immediate flush (useful for cleanup on deactivation).
   */
  public async forceFlush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.flush();
  }

  /**
   * Dispose resources.
   */
  public dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.pendingWorkspaces.clear();
  }
}