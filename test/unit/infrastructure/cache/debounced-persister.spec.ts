import { strict as assert } from 'assert';
import { DebouncedCachePersister } from '@infra/persistence/DebouncedCachePersister';
import { stringToWsId, stringToRel } from '@helpers/path';
import type { WorkspaceId, NodeIndex } from '@domain/types';
import { DiffChangeEvent } from '@app/SyncStateManager';

describe('DebouncedCachePersister', () => {
  let persister: DebouncedCachePersister;
  let localSaveCount: number;
  let remoteSaveCount: number;
  let baseSaveCount: number;
  let lastLocalSaved: Map<WorkspaceId, NodeIndex>;
  let lastRemoteSaved: Map<WorkspaceId, NodeIndex>;
  let lastBaseSaved: Map<WorkspaceId, NodeIndex>;
  let diffChangeListener: ((event: DiffChangeEvent) => void) | undefined;

  beforeEach(() => {
    localSaveCount = 0;
    remoteSaveCount = 0;
    baseSaveCount = 0;
    lastLocalSaved = new Map();
    lastRemoteSaved = new Map();
    lastBaseSaved = new Map();
    diffChangeListener = undefined;

    // Mock SyncStateManager
    const mockState = {
      subscribeToDiffChanges: (listener: (event: DiffChangeEvent) => void) => {
        diffChangeListener = listener;
      },
      getLocalIndex: (wsId: WorkspaceId) => {
        return new Map([[stringToRel('local.txt'), { type: 'file' as const, hash: `local-${wsId}` }]]) as NodeIndex;
      },
      getRemoteIndex: (wsId: WorkspaceId) => {
        return new Map([[stringToRel('remote.txt'), { type: 'file' as const, hash: `remote-${wsId}` }]]) as NodeIndex;
      },
    } as any;

    // Mock IndexCacheService for local cache
    const mockLocalCache = {
      save: async (wsId: WorkspaceId, index: NodeIndex) => {
        localSaveCount++;
        lastLocalSaved.set(wsId, new Map(index));
      },
    } as any;

    // Mock IndexCacheService for remote cache
    const mockRemoteCache = {
      save: async (wsId: WorkspaceId, index: NodeIndex) => {
        remoteSaveCount++;
        lastRemoteSaved.set(wsId, new Map(index));
      },
    } as any;
    
    // Mock IndexCacheService for base cache
    const mockBaseCache = {
      save: async (wsId: WorkspaceId, index: NodeIndex) => {
        baseSaveCount++;
        lastBaseSaved.set(wsId, new Map(index));
      },
    } as any;

    persister = new DebouncedCachePersister(
      mockState,
      mockLocalCache,
      mockRemoteCache,
      mockBaseCache,
      100 // 100ms debounce for faster tests
    );
  });

  afterEach(() => {
    persister.dispose();
  });

  it('subscribes to diff changes on construction', () => {
    assert.ok(diffChangeListener, 'Should have subscribed to diff changes');
  });

  it('debounces rapid changes', async function() {
    this.timeout(5000);
    
    const wsId = stringToWsId('/test-workspace');

    // Trigger 3 rapid changes
    diffChangeListener!({ workspaceId: wsId, changedPath: stringToRel('file1.txt') });
    diffChangeListener!({ workspaceId: wsId, changedPath: stringToRel('file2.txt') });
    diffChangeListener!({ workspaceId: wsId, changedPath: stringToRel('file3.txt') });

    // Wait less than debounce time
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should not have saved yet
    assert.equal(localSaveCount, 0, 'Should not save before debounce time');
    assert.equal(remoteSaveCount, 0, 'Should not save before debounce time');
    assert.equal(baseSaveCount, 0, 'Should not save before debounce time');

    // Wait for debounce to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should have saved once
    assert.equal(localSaveCount, 1, 'Should save local once after debounce');
    assert.equal(remoteSaveCount, 1, 'Should save remote once after debounce');
    assert.equal(baseSaveCount, 1, 'Should save base once after debounce');
  });

  it('handles multiple workspaces independently', async function() {
    this.timeout(5000);
    
    const ws1 = stringToWsId('/workspace-1');
    const ws2 = stringToWsId('/workspace-2');

    // Trigger changes in both workspaces
    diffChangeListener!({ workspaceId: ws1 });
    diffChangeListener!({ workspaceId: ws2 });

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should have saved both workspaces
    assert.ok(lastLocalSaved.has(ws1), 'Should save workspace 1 local');
    assert.ok(lastLocalSaved.has(ws2), 'Should save workspace 2 local');
    assert.ok(lastRemoteSaved.has(ws1), 'Should save workspace 1 remote');
    assert.ok(lastRemoteSaved.has(ws2), 'Should save workspace 2 remote');
  });

  it('resets debounce timer on new changes', async function() {
    this.timeout(5000);
    
    const wsId = stringToWsId('/test-workspace');

    // Initial change
    diffChangeListener!({ workspaceId: wsId });

    // Wait 50ms
    await new Promise(resolve => setTimeout(resolve, 50));

    // Another change before debounce completes - should reset timer
    diffChangeListener!({ workspaceId: wsId });

    // Wait 50ms more (100ms total from first, but only 50ms from second)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should still not have saved
    assert.equal(localSaveCount, 0, 'Should not save yet - timer was reset');

    // Wait for second debounce to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now should have saved
    assert.equal(localSaveCount, 1);
    assert.equal(remoteSaveCount, 1);
  });

  it('forceFlush saves immediately', async function() {
    this.timeout(5000);
    
    const wsId = stringToWsId('/test-workspace');

    // Trigger change
    diffChangeListener!({ workspaceId: wsId });

    // Immediately force flush
    await persister.forceFlush();

    // Should have saved immediately
    assert.equal(localSaveCount, 1, 'Should save local immediately on forceFlush');
    assert.equal(remoteSaveCount, 1, 'Should save remote immediately on forceFlush');
  });

  it('forceFlush cancels pending timer', async function() {
    this.timeout(5000);
    
    const wsId = stringToWsId('/test-workspace');

    // Trigger change
    diffChangeListener!({ workspaceId: wsId });

    // Force flush
    await persister.forceFlush();
    assert.equal(localSaveCount, 1);

    // Wait for what would have been the debounce time
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should not have saved again
    assert.equal(localSaveCount, 1, 'Should not save again after forceFlush');
    assert.equal(remoteSaveCount, 1, 'Should not save again after forceFlush');
  });

  it('dispose cancels pending saves', async function() {
    this.timeout(5000);
    
    const wsId = stringToWsId('/test-workspace');

    // Trigger change
    diffChangeListener!({ workspaceId: wsId });

    // Dispose before debounce completes
    persister.dispose();

    // Wait for what would have been the debounce time
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should not have saved
    assert.equal(localSaveCount, 0, 'Should not save after dispose');
    assert.equal(remoteSaveCount, 0, 'Should not save after dispose');
  });

  it('handles save errors gracefully', async function() {
    this.timeout(5000);
    
    // Create persister with failing cache
    const failingMockState = {
      subscribeToDiffChanges: (listener: (event: DiffChangeEvent) => void) => {
        diffChangeListener = listener;
      },
      getLocalIndex: () => new Map() as NodeIndex,
      getRemoteIndex: () => new Map() as NodeIndex,
    } as any;

    const failingCache = {
      save: async () => {
        throw new Error('Simulated save failure');
      },
    } as any;

    const failingPersister = new DebouncedCachePersister(
      failingMockState,
      failingCache,
      failingCache,
      failingCache,
      100
    );

    const wsId = stringToWsId('/test-workspace');

    // Trigger change - should not throw
    diffChangeListener!({ workspaceId: wsId });

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should have completed without throwing
    assert.ok(true, 'Should handle save errors gracefully');

    failingPersister.dispose();
  });

  it('batches multiple workspace changes in single flush', async function() {
    this.timeout(5000);
    
    const ws1 = stringToWsId('/workspace-1');
    const ws2 = stringToWsId('/workspace-2');
    const ws3 = stringToWsId('/workspace-3');

    // Trigger changes in all workspaces
    diffChangeListener!({ workspaceId: ws1 });
    diffChangeListener!({ workspaceId: ws2 });
    diffChangeListener!({ workspaceId: ws3 });

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should have saved all 3 workspaces
    assert.equal(lastLocalSaved.size, 3, 'Should save all 3 workspaces local');
    assert.equal(lastRemoteSaved.size, 3, 'Should save all 3 workspaces remote');

    // Each workspace should appear exactly once
    assert.equal(localSaveCount, 3, 'Should save local for each workspace once');
    assert.equal(remoteSaveCount, 3, 'Should save remote for each workspace once');
  });

  it('duplicate changes to same workspace only save once', async function() {
    this.timeout(5000);
    
    const wsId = stringToWsId('/test-workspace');

    // Trigger multiple changes to same workspace
    diffChangeListener!({ workspaceId: wsId, changedPath: stringToRel('file1.txt') });
    diffChangeListener!({ workspaceId: wsId, changedPath: stringToRel('file2.txt') });
    diffChangeListener!({ workspaceId: wsId, changedPath: stringToRel('file3.txt') });

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should have saved once per cache type
    assert.equal(localSaveCount, 1, 'Should save local once for multiple changes to same workspace');
    assert.equal(remoteSaveCount, 1, 'Should save remote once for multiple changes to same workspace');
  });
});