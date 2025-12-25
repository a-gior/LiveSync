import { strict as assert } from 'assert';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { stringToWsId, stringToRel } from '@helpers/path';
import type { WorkspaceId, NodeIndex } from '@domain/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('IndexCacheService', () => {
  let tempWorkspaceDir: string;
  let cacheService: IndexCacheService;
  let wsId: WorkspaceId;

  beforeEach(async () => {
    // Create temp workspace directory
    tempWorkspaceDir = path.join(os.tmpdir(), `livesync-cache-test-${Date.now()}`);
    await fs.mkdir(tempWorkspaceDir, { recursive: true });
    wsId = stringToWsId(tempWorkspaceDir);
    
    cacheService = new IndexCacheService('index.local.json');
  });

  afterEach(async () => {
    await fs.rm(tempWorkspaceDir, { recursive: true, force: true });
  });

  it('saves and loads index correctly', async () => {
    const index: NodeIndex = new Map([
      [stringToRel('file.txt'), { type: 'file' as const, hash: 'abc123', size: 100, mtimeMs: 1000 }],
      [stringToRel('src'), { type: 'folder' as const, hash: 'def456', childCount: 2 }],
      [stringToRel('src/app.ts'), { type: 'file' as const, hash: 'xyz789', size: 200 }],
    ]);

    await cacheService.save(wsId, index);
    const loaded = await cacheService.load(wsId);

    assert.ok(loaded, 'Loaded index should exist');
    assert.equal(loaded.size, 3, 'Should have 3 entries');
    
    const file = loaded.get(stringToRel('file.txt'));
    assert.ok(file);
    assert.equal(file.type, 'file');
    assert.equal(file.hash, 'abc123');
    if (file.type === 'file') {
      assert.equal(file.size, 100);
      assert.equal(file.mtimeMs, 1000);
    }
    
    const folder = loaded.get(stringToRel('src'));
    assert.ok(folder);
    assert.equal(folder.type, 'folder');
    assert.equal(folder.hash, 'def456');
  });

  it('returns undefined for non-existent cache', async () => {
    const nonExistentWs = stringToWsId('/nonexistent-workspace');
    const loaded = await cacheService.load(nonExistentWs);
    
    assert.equal(loaded, undefined, 'Should return undefined for non-existent cache');
  });

  it('handles corrupted cache files gracefully', async () => {
    // First create valid cache
    await cacheService.save(wsId, new Map());
    
    // Then corrupt it
    const cacheFile = path.join(tempWorkspaceDir, '.livesync', 'index.local.json');
    await fs.writeFile(cacheFile, '{corrupt json content without closing brace');
    
    const loaded = await cacheService.load(wsId);
    
    assert.equal(loaded, undefined, 'Should return undefined for corrupted cache');
  });

  it('creates .livesync directory if missing', async () => {
    const livesyncDir = path.join(tempWorkspaceDir, '.livesync');
    
    // Verify directory doesn't exist
    await assert.rejects(
      () => fs.access(livesyncDir),
      'Directory should not exist initially'
    );
    
    const index: NodeIndex = new Map([[stringToRel('file.txt'), { type: 'file' as const, hash: 'abc' }]]);
    
    await cacheService.save(wsId, index);
    
    // Verify directory was created
    const stat = await fs.stat(livesyncDir);
    assert.ok(stat.isDirectory(), '.livesync directory should be created');
  });

  it('handles empty index', async () => {
    const emptyIndex: NodeIndex = new Map();
    
    await cacheService.save(wsId, emptyIndex);
    const loaded = await cacheService.load(wsId);
    
    assert.ok(loaded);
    assert.equal(loaded.size, 0, 'Empty index should load as empty');
  });

  it('preserves file metadata', async () => {
    const index: NodeIndex = new Map([
      [stringToRel('test.txt'), { 
        type: 'file' as const, 
        hash: 'sha256hash', 
        size: 12345,
        mtimeMs: 1609459200000
      }],
    ]);

    await cacheService.save(wsId, index);
    const loaded = await cacheService.load(wsId);

    assert.ok(loaded);
    const file = loaded.get(stringToRel('test.txt'));
    assert.ok(file);
    assert.equal(file.type, 'file');
    assert.equal(file.hash, 'sha256hash');
    if (file.type === 'file') {
      assert.equal(file.size, 12345);
      assert.equal(file.mtimeMs, 1609459200000);
    }
  });

  it('preserves folder metadata', async () => {
    const index: NodeIndex = new Map([
      [stringToRel('src'), { 
        type: 'folder' as const, 
        hash: 'folderhash',
        childCount: 5
      }],
    ]);

    await cacheService.save(wsId, index);
    const loaded = await cacheService.load(wsId);

    assert.ok(loaded);
    const folder = loaded.get(stringToRel('src'));
    assert.ok(folder);
    assert.equal(folder.type, 'folder');
    assert.equal(folder.hash, 'folderhash');
    if (folder.type === 'folder') {
      assert.equal(folder.childCount, 5);
    }
  });

  it('handles paths with forward slashes', async () => {
    const index: NodeIndex = new Map([
      [stringToRel('src/utils/helper.ts'), { type: 'file' as const, hash: 'abc' }],
    ]);

    await cacheService.save(wsId, index);
    const loaded = await cacheService.load(wsId);

    assert.ok(loaded);
    assert.ok(loaded.has(stringToRel('src/utils/helper.ts')));
  });

  it('local and remote caches are independent', async () => {
    const localCache = new IndexCacheService('index.local.json');
    const remoteCache = new IndexCacheService('index.remote.json');

    const localIndex: NodeIndex = new Map([
      [stringToRel('local.txt'), { type: 'file' as const, hash: 'local-hash' }],
    ]);

    const remoteIndex: NodeIndex = new Map([
      [stringToRel('remote.txt'), { type: 'file' as const, hash: 'remote-hash' }],
    ]);

    await localCache.save(wsId, localIndex);
    await remoteCache.save(wsId, remoteIndex);

    const loadedLocal = await localCache.load(wsId);
    const loadedRemote = await remoteCache.load(wsId);

    assert.ok(loadedLocal);
    assert.ok(loadedRemote);
    assert.ok(loadedLocal.has(stringToRel('local.txt')));
    assert.ok(!loadedLocal.has(stringToRel('remote.txt')));
    assert.ok(loadedRemote.has(stringToRel('remote.txt')));
    assert.ok(!loadedRemote.has(stringToRel('local.txt')));
  });

  it('overwrites existing cache on save', async () => {
    const index1: NodeIndex = new Map([
      [stringToRel('file1.txt'), { type: 'file' as const, hash: 'hash1' }],
    ]);

    const index2: NodeIndex = new Map([
      [stringToRel('file2.txt'), { type: 'file' as const, hash: 'hash2' }],
    ]);

    await cacheService.save(wsId, index1);
    await cacheService.save(wsId, index2);

    const loaded = await cacheService.load(wsId);

    assert.ok(loaded);
    assert.equal(loaded.size, 1);
    assert.ok(!loaded.has(stringToRel('file1.txt')), 'Old entry should be gone');
    assert.ok(loaded.has(stringToRel('file2.txt')), 'New entry should exist');
  });
});