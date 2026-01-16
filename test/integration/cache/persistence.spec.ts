import { strict as assert } from 'assert';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { DebouncedCachePersister } from '@infra/persistence/DebouncedCachePersister';
import { SyncStateManager } from '@app/SyncStateManager';
import { DefaultDiffEngine } from '@domain/diff/DiffEngine';
import { stringToWsId, stringToRel } from '@helpers/path';
import type { WorkspaceId, NodeIndex } from '@domain/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigValidator } from '../../../src/infrastructure/config/ConfigValidator';

describe('Cache Persistence Integration', function() {
  this.timeout(10000);

  let tempWorkspaceDir: string;
  let wsId: WorkspaceId;

  function createMockValidator(): ConfigValidator {
    return {
      getCached: async () => ({ hasConfig: true, isValid: true })
    } as unknown as ConfigValidator;
  }

  beforeEach(async () => {
    tempWorkspaceDir = path.join(os.tmpdir(), `livesync-cache-int-${Date.now()}`);
    await fs.mkdir(tempWorkspaceDir, { recursive: true });
    wsId = stringToWsId(tempWorkspaceDir);
  });

  afterEach(async () => {
    await fs.rm(tempWorkspaceDir, { recursive: true, force: true });
  });

  it('persisted cache survives service recreation', async () => {
    const localCache1 = new IndexCacheService('index.local.json');
    const remoteCache1 = new IndexCacheService('index.remote.json');

    const localIndex: NodeIndex = new Map([
      [stringToRel('file.txt'), { type: 'file' as const, hash: 'abc123', size: 100 }],
      [stringToRel('src/app.ts'), { type: 'file' as const, hash: 'def456', size: 200 }],
    ]);

    const remoteIndex: NodeIndex = new Map([
      [stringToRel('file.txt'), { type: 'file' as const, hash: 'abc123', size: 100 }],
      [stringToRel('remote-only.txt'), { type: 'file' as const, hash: 'xyz789' }],
    ]);

    // Save with first service instance
    await localCache1.save(wsId, localIndex);
    await remoteCache1.save(wsId, remoteIndex);

    // Create new service instances (simulates extension reload)
    const localCache2 = new IndexCacheService('index.local.json');
    const remoteCache2 = new IndexCacheService('index.remote.json');

    const loadedLocal = await localCache2.load(wsId);
    const loadedRemote = await remoteCache2.load(wsId);

    assert.ok(loadedLocal);
    assert.ok(loadedRemote);
    assert.equal(loadedLocal.size, 2);
    assert.equal(loadedRemote.size, 2);
    assert.equal(loadedLocal.get(stringToRel('file.txt'))?.hash, 'abc123');
    assert.equal(loadedRemote.get(stringToRel('remote-only.txt'))?.hash, 'xyz789');
  });

  it('DebouncedCachePersister integrates with real caches and state', async () => {
    const diffEngine = new DefaultDiffEngine();
    const state = new SyncStateManager(diffEngine);
    const localCache = new IndexCacheService('index.local.json');
    const remoteCache = new IndexCacheService('index.remote.json');
    const baseCache = new IndexCacheService('index.base.json');

    const persister = new DebouncedCachePersister(
      state,
      localCache,
      remoteCache,
      baseCache,
      createMockValidator(),
      100 // 100ms debounce
    );

    // Set indexes in state - should trigger cache save
    const localIndex: NodeIndex = new Map([
      [stringToRel('local.txt'), { type: 'file' as const, hash: 'local-hash' }],
    ]);

    const remoteIndex: NodeIndex = new Map([
      [stringToRel('remote.txt'), { type: 'file' as const, hash: 'remote-hash' }],
    ]);

    state.setLocalIndex(wsId, localIndex);
    state.setRemoteIndex(wsId, remoteIndex);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 200));

    // Load from cache
    const loadedLocal = await localCache.load(wsId);
    const loadedRemote = await remoteCache.load(wsId);

    assert.ok(loadedLocal, 'Local cache should be saved');
    assert.ok(loadedRemote, 'Remote cache should be saved');
    assert.ok(loadedLocal.has(stringToRel('local.txt')));
    assert.ok(loadedRemote.has(stringToRel('remote.txt')));

    persister.dispose();
  });

  it('forceFlush ensures immediate persistence', async () => {
    const diffEngine = new DefaultDiffEngine();
    const state = new SyncStateManager(diffEngine);
    const localCache = new IndexCacheService('index.local.json');
    const remoteCache = new IndexCacheService('index.remote.json');
    const baseCache = new IndexCacheService('index.base.json');

    const persister = new DebouncedCachePersister(state, localCache, remoteCache, baseCache, createMockValidator(), 1000);

    const localIndex: NodeIndex = new Map([
      [stringToRel('urgent.txt'), { type: 'file' as const, hash: 'urgent-hash' }],
    ]);

    state.setLocalIndex(wsId, localIndex);

    // Force flush immediately without waiting for debounce
    await persister.forceFlush();

    // Should be persisted immediately
    const loaded = await localCache.load(wsId);
    assert.ok(loaded);
    assert.ok(loaded.has(stringToRel('urgent.txt')));

    persister.dispose();
  });

  it('handles concurrent workspace updates', async () => {
    const diffEngine = new DefaultDiffEngine();
    const state = new SyncStateManager(diffEngine);
    const localCache = new IndexCacheService('index.local.json');
    const remoteCache = new IndexCacheService('index.remote.json');
    const baseCache = new IndexCacheService('index.base.json');

    const persister = new DebouncedCachePersister(state, localCache, remoteCache, baseCache, createMockValidator(), 100);

    // Create multiple workspace directories
    const ws1 = wsId;
    const ws2Dir = path.join(os.tmpdir(), `livesync-cache-int-2-${Date.now()}`);
    await fs.mkdir(ws2Dir, { recursive: true });
    const ws2 = stringToWsId(ws2Dir);

    const ws3Dir = path.join(os.tmpdir(), `livesync-cache-int-3-${Date.now()}`);
    await fs.mkdir(ws3Dir, { recursive: true });
    const ws3 = stringToWsId(ws3Dir);

    try {
      // Update all workspaces
      state.setLocalIndex(ws1, new Map([[stringToRel('file1.txt'), { type: 'file' as const, hash: 'h1' }]]));
      state.setLocalIndex(ws2, new Map([[stringToRel('file2.txt'), { type: 'file' as const, hash: 'h2' }]]));
      state.setLocalIndex(ws3, new Map([[stringToRel('file3.txt'), { type: 'file' as const, hash: 'h3' }]]));

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 200));

      // All should be persisted
      const loaded1 = await localCache.load(ws1);
      const loaded2 = await localCache.load(ws2);
      const loaded3 = await localCache.load(ws3);

      assert.ok(loaded1 && loaded2 && loaded3);
      assert.equal(loaded1.get(stringToRel('file1.txt'))?.hash, 'h1');
      assert.equal(loaded2.get(stringToRel('file2.txt'))?.hash, 'h2');
      assert.equal(loaded3.get(stringToRel('file3.txt'))?.hash, 'h3');

    } finally {
      persister.dispose();
      await fs.rm(ws2Dir, { recursive: true, force: true });
      await fs.rm(ws3Dir, { recursive: true, force: true });
    }
  });

  it('cache survives multiple update cycles', async () => {
    const diffEngine = new DefaultDiffEngine();
    const state = new SyncStateManager(diffEngine);
    const localCache = new IndexCacheService('index.local.json');
    const remoteCache = new IndexCacheService('index.remote.json');
    const baseCache = new IndexCacheService('index.base.json');

    const persister = new DebouncedCachePersister(state, localCache, remoteCache, baseCache, createMockValidator(), 100);

    // First update
    state.setLocalIndex(wsId, new Map([
      [stringToRel('v1.txt'), { type: 'file' as const, hash: 'v1-hash' }],
    ]));
    await new Promise(resolve => setTimeout(resolve, 150));

    // Second update
    state.setLocalIndex(wsId, new Map([
      [stringToRel('v2.txt'), { type: 'file' as const, hash: 'v2-hash' }],
    ]));
    await new Promise(resolve => setTimeout(resolve, 150));

    // Third update
    state.setLocalIndex(wsId, new Map([
      [stringToRel('v3.txt'), { type: 'file' as const, hash: 'v3-hash' }],
    ]));
    await new Promise(resolve => setTimeout(resolve, 150));

    // Final state should be v3
    const loaded = await localCache.load(wsId);
    assert.ok(loaded);
    assert.equal(loaded.size, 1);
    assert.ok(loaded.has(stringToRel('v3.txt')));
    assert.ok(!loaded.has(stringToRel('v1.txt')));
    assert.ok(!loaded.has(stringToRel('v2.txt')));

    persister.dispose();
  });

  it('cache file format is valid JSON', async () => {
    const localCache = new IndexCacheService('index.local.json');

    const index: NodeIndex = new Map([
      [stringToRel('file.txt'), { type: 'file' as const, hash: 'abc123' }],
    ]);

    await localCache.save(wsId, index);

    // Read raw file
    const cacheFilePath = path.join(tempWorkspaceDir, '.livesync', 'index.local.json');
    const rawContent = await fs.readFile(cacheFilePath, 'utf-8');

    // Should be valid JSON
    const parsed = JSON.parse(rawContent);
    assert.ok(parsed.version);
    assert.ok(parsed.timestamp);
    assert.ok(parsed.entries);
    assert.equal(parsed.version, 1);
  });

  it('handles rapid index updates without data loss', async () => {
    const diffEngine = new DefaultDiffEngine();
    const state = new SyncStateManager(diffEngine);
    const localCache = new IndexCacheService('index.local.json');
    const remoteCache = new IndexCacheService('index.remote.json');
    const baseCache = new IndexCacheService('index.base.json');

    const persister = new DebouncedCachePersister(state, localCache, remoteCache, baseCache, createMockValidator(), 100);

    // Rapid updates (10 updates in quick succession)
    for (let i = 0; i < 10; i++) {
      state.setLocalIndex(wsId, new Map([
        [stringToRel(`file-${i}.txt`), { type: 'file' as const, hash: `hash-${i}` }],
      ]));
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Force flush to ensure last state is saved
    await persister.forceFlush();

    // Should have the last state
    const loaded = await localCache.load(wsId);
    assert.ok(loaded);
    assert.ok(loaded.has(stringToRel('file-9.txt')));

    persister.dispose();
  });
});