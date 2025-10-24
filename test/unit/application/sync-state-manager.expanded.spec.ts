import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../../src/domain/diff/DiffEngine';
import { SyncStateManager } from '../../../src/application/SyncStateManager';
import type { FileMeta, FolderMeta, NodeMeta, RelPath, WorkspaceId } from '../../../src/domain/types';
import { stringToRel, stringToWsId } from '../../../src/infrastructure/helpers/path';

// ============================================================================
// Test Helpers
// ============================================================================

const file = (hash: string, size?: number, mtimeMs?: number): FileMeta => ({
  type: 'file',
  hash,
  ...(size !== undefined && { size }),
  ...(mtimeMs !== undefined && { mtimeMs }),
});

const folder = (hash: string, childCount?: number): FolderMeta => ({
  type: 'folder',
  hash,
  ...(childCount !== undefined && { childCount }),
});

/**
 * Helper to create a properly typed NodeIndex from mixed entries.
 * This avoids TypeScript errors when mixing FileMeta and FolderMeta.
 */
function createIndex(entries: Array<[RelPath, NodeMeta]>): Map<RelPath, NodeMeta> {
  return new Map(entries);
}

// ============================================================================
// SyncStateManager — Expanded Test Suite
// ============================================================================

describe('SyncStateManager (Expanded)', () => {
  const ws: WorkspaceId = stringToWsId('/test-workspace');
  let engine: DefaultDiffEngine;
  let state: SyncStateManager;

  beforeEach(() => {
    engine = new DefaultDiffEngine();
    state = new SyncStateManager(engine);
  });

  describe('Initial State', () => {
    it('returns undefined for entries in empty workspace', () => {
      const entry = state.getDiffEntry(ws, stringToRel('nonexistent.txt'));
      assert.equal(entry, undefined);
    });

    it('getChildren returns empty array for empty workspace', () => {
      const children = state.getChildren(ws, stringToRel(''));
      assert.deepEqual(children, []);
    });

    it('getDiffEntries returns empty map for empty workspace', () => {
      const entries = state.getDiffEntries(ws);
      assert.equal(entries.size, 0);
    });
  });

  describe('setLocalIndex / setRemoteIndex', () => {
    it('replacing local index triggers recompute', () => {
      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      const localIndex = createIndex([
        [stringToRel('a.txt'), file('hashA')],
      ]);

      state.setLocalIndex(ws, localIndex);
      assert.equal(emitCount, 1, 'should emit once after setLocalIndex');

      const entry = state.getDiffEntry(ws, stringToRel('a.txt'));
      assert.equal(entry?.status, 'added');
    });

    it('replacing remote index triggers recompute', () => {
      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      const remoteIndex = createIndex([
        [stringToRel('b.txt'), file('hashB')],
      ]);

      state.setRemoteIndex(ws, remoteIndex);
      assert.equal(emitCount, 1, 'should emit once after setRemoteIndex');

      const entry = state.getDiffEntry(ws, stringToRel('b.txt'));
      assert.equal(entry?.status, 'removed');
    });

    it('computes diff correctly after setting both indexes', () => {
      const localIndex = createIndex([
        [stringToRel('same.txt'), file('X')],
        [stringToRel('local-only.txt'), file('L')],
      ]);

      const remoteIndex = createIndex([
        [stringToRel('same.txt'), file('X')],
        [stringToRel('remote-only.txt'), file('R')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, remoteIndex);

      assert.equal(state.getDiffEntry(ws, stringToRel('same.txt'))?.status, 'unchanged');
      assert.equal(state.getDiffEntry(ws, stringToRel('local-only.txt'))?.status, 'added');
      assert.equal(state.getDiffEntry(ws, stringToRel('remote-only.txt'))?.status, 'removed');
    });
  });

  describe('applyLocal — file operations', () => {
    it('create: adds file to local index and updates diff', () => {
      state.setLocalIndex(ws, createIndex([]));
      state.setRemoteIndex(ws, createIndex([]));

      state.applyLocal({
        workspaceId: ws,
        type: 'create',
        path: stringToRel('new.txt'),
        meta: file('hash1'),
      });

      const entry = state.getDiffEntry(ws, stringToRel('new.txt'));
      assert.equal(entry?.status, 'added');
      assert.equal(entry?.left?.hash, 'hash1');
    });

    it('modify: updates file hash in local index', () => {
      const localIndex = createIndex([
        [stringToRel('file.txt'), file('oldHash')],
      ]);
      const remoteIndex = createIndex([
        [stringToRel('file.txt'), file('oldHash')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, remoteIndex);

      assert.equal(state.getDiffEntry(ws, stringToRel('file.txt'))?.status, 'unchanged');

      state.applyLocal({
        workspaceId: ws,
        type: 'modify',
        path: stringToRel('file.txt'),
        meta: file('newHash'),
      });

      const entry = state.getDiffEntry(ws, stringToRel('file.txt'));
      assert.equal(entry?.status, 'modified');
      assert.equal(entry?.left?.hash, 'newHash');
    });

    it('delete: removes file from local index', () => {
      const localIndex = createIndex([
        [stringToRel('file.txt'), file('hash')],
      ]);
      const remoteIndex = createIndex([
        [stringToRel('file.txt'), file('hash')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, remoteIndex);

      state.applyLocal({
        workspaceId: ws,
        type: 'delete',
        path: stringToRel('file.txt'),
      });

      const entry = state.getDiffEntry(ws, stringToRel('file.txt'));
      assert.equal(entry?.status, 'removed');
      assert.equal(entry?.left, undefined);
    });

    it('rename: removes old path and creates new path', () => {
      const localIndex = createIndex([
        [stringToRel('old.txt'), file('hash')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, createIndex([]));

      state.applyLocal({
        workspaceId: ws,
        type: 'rename',
        path: stringToRel('old.txt'),
        newPath: stringToRel('new.txt'),
        meta: file('hash'),
      });

      assert.equal(state.getDiffEntry(ws, stringToRel('old.txt')), undefined);
      const newEntry = state.getDiffEntry(ws, stringToRel('new.txt'));
      assert.equal(newEntry?.status, 'added');
    });
  });

  describe('applyRemote — file operations', () => {
    it('create: adds file to remote index', () => {
      state.setLocalIndex(ws, createIndex([]));
      state.setRemoteIndex(ws, createIndex([]));

      state.applyRemote({
        workspaceId: ws,
        type: 'create',
        path: stringToRel('new.txt'),
        meta: file('hash1'),
      });

      const entry = state.getDiffEntry(ws, stringToRel('new.txt'));
      assert.equal(entry?.status, 'removed');
      assert.equal(entry?.right?.hash, 'hash1');
    });

    it('modify: updates file hash in remote index', () => {
      const localIndex = createIndex([
        [stringToRel('file.txt'), file('localHash')],
      ]);
      const remoteIndex = createIndex([
        [stringToRel('file.txt'), file('oldRemoteHash')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, remoteIndex);

      state.applyRemote({
        workspaceId: ws,
        type: 'modify',
        path: stringToRel('file.txt'),
        meta: file('localHash'),
      });

      const entry = state.getDiffEntry(ws, stringToRel('file.txt'));
      assert.equal(entry?.status, 'unchanged');
      assert.equal(entry?.right?.hash, 'localHash');
    });

    it('delete: removes file from remote index', () => {
      const localIndex = createIndex([]);
      const remoteIndex = createIndex([
        [stringToRel('file.txt'), file('hash')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, remoteIndex);

      state.applyRemote({
        workspaceId: ws,
        type: 'delete',
        path: stringToRel('file.txt'),
      });

      const entry = state.getDiffEntry(ws, stringToRel('file.txt'));
      assert.equal(entry, undefined);
    });

    it('rename: removes old path and creates new path in remote', () => {
      const remoteIndex = createIndex([
        [stringToRel('old.txt'), file('hash')],
      ]);

      state.setLocalIndex(ws, createIndex([]));
      state.setRemoteIndex(ws, remoteIndex);

      state.applyRemote({
        workspaceId: ws,
        type: 'rename',
        path: stringToRel('old.txt'),
        newPath: stringToRel('new.txt'),
        meta: file('hash'),
      });

      assert.equal(state.getDiffEntry(ws, stringToRel('old.txt')), undefined);
      const newEntry = state.getDiffEntry(ws, stringToRel('new.txt'));
      assert.equal(newEntry?.status, 'removed');
    });
  });

  describe('Folder Operations', () => {
    it('applyLocal create folder', () => {
      state.setLocalIndex(ws, createIndex([]));
      state.setRemoteIndex(ws, createIndex([]));

      state.applyLocal({
        workspaceId: ws,
        type: 'create',
        path: stringToRel('newdir'),
        meta: folder('folderHash'),
      });

      const entry = state.getDiffEntry(ws, stringToRel('newdir'));
      assert.equal(entry?.status, 'added');
      assert.equal(entry?.type, 'folder');
    });

    it('applyLocal delete folder removes all descendants', () => {
      const localIndex = createIndex([
        [stringToRel('dir'), folder('dirHash')],
        [stringToRel('dir/file.txt'), file('hash1')],
        [stringToRel('dir/subdir'), folder('subdirHash')],
        [stringToRel('dir/subdir/file2.txt'), file('hash2')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, createIndex([]));

      state.applyLocal({
        workspaceId: ws,
        type: 'delete',
        path: stringToRel('dir'),
      });

      assert.equal(state.getDiffEntry(ws, stringToRel('dir')), undefined);
      assert.equal(state.getDiffEntry(ws, stringToRel('dir/file.txt')), undefined);
      assert.equal(state.getDiffEntry(ws, stringToRel('dir/subdir')), undefined);
      assert.equal(state.getDiffEntry(ws, stringToRel('dir/subdir/file2.txt')), undefined);
    });

    it('applyLocal rename folder moves all descendants', () => {
      const localIndex = createIndex([
        [stringToRel('olddir'), folder('dirHash')],
        [stringToRel('olddir/file.txt'), file('hash1')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, createIndex([]));

      state.applyLocal({
        workspaceId: ws,
        type: 'rename',
        path: stringToRel('olddir'),
        newPath: stringToRel('newdir'),
        meta: folder('dirHash'),
      });

      assert.equal(state.getDiffEntry(ws, stringToRel('olddir')), undefined);
      assert.equal(state.getDiffEntry(ws, stringToRel('olddir/file.txt')), undefined);

      const newDirEntry = state.getDiffEntry(ws, stringToRel('newdir'));
      assert.equal(newDirEntry?.status, 'added');

      const newFileEntry = state.getDiffEntry(ws, stringToRel('newdir/file.txt'));
      assert.equal(newFileEntry?.status, 'added');
    });
  });

  describe('runBatch — batching multiple operations', () => {
    it('defers recompute until batch ends', () => {
      state.setLocalIndex(ws, createIndex([
        [stringToRel('a.txt'), file('A')],
        [stringToRel('b.txt'), file('B')],
        [stringToRel('c.txt'), file('C')],
      ]));
      state.setRemoteIndex(ws, createIndex([]));

      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      // Without batch, this would emit 3 times
      state.runBatch(ws, stringToRel(''), () => {
        state.applyLocal({
          workspaceId: ws,
          type: 'modify',
          path: stringToRel('a.txt'),
          meta: file('A2'),
        });
        state.applyLocal({
          workspaceId: ws,
          type: 'modify',
          path: stringToRel('b.txt'),
          meta: file('B2'),
        });
        state.applyLocal({
          workspaceId: ws,
          type: 'modify',
          path: stringToRel('c.txt'),
          meta: file('C2'),
        });
      });

      assert.equal(emitCount, 1, 'should emit only once after batch completes');
    });

    it('applies all changes correctly in batch', () => {
      state.setLocalIndex(ws, createIndex([
        [stringToRel('dir/1.txt'), file('A')],
        [stringToRel('dir/2.txt'), file('B')],
        [stringToRel('dir/3.txt'), file('C')],
      ]));
      state.setRemoteIndex(ws, createIndex([
        [stringToRel('dir/1.txt'), file('X')],
        [stringToRel('dir/2.txt'), file('Y')],
        [stringToRel('dir/3.txt'), file('Z')],
      ]));

      state.runBatch(ws, stringToRel('dir'), () => {
        for (const name of ['dir/1.txt', 'dir/2.txt', 'dir/3.txt']) {
          const path = stringToRel(name);
          const localMeta = state.getLocalMeta(ws, path);
          state.applyRemote({
            workspaceId: ws,
            type: 'modify',
            path,
            meta: localMeta!,
          });
        }
      });

      // All should now be unchanged
      for (const name of ['dir/1.txt', 'dir/2.txt', 'dir/3.txt']) {
        const entry = state.getDiffEntry(ws, stringToRel(name));
        assert.equal(entry?.status, 'unchanged', `${name} should be unchanged`);
      }
    });
  });

  describe('getChildren', () => {
    it('returns immediate children only (not recursive)', () => {
      const localIndex = createIndex([
        [stringToRel('a.txt'), file('hashA')],
        [stringToRel('dir/b.txt'), file('hashB')],
        [stringToRel('dir/subdir/c.txt'), file('hashC')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, createIndex([]));

      const rootChildren = state.getChildren(ws, stringToRel(''));
      assert.equal(rootChildren.length, 2);
      assert.ok(rootChildren.includes(stringToRel('a.txt')));
      assert.ok(rootChildren.includes(stringToRel('dir')));

      const dirChildren = state.getChildren(ws, stringToRel('dir'));
      assert.equal(dirChildren.length, 2);
      assert.ok(dirChildren.includes(stringToRel('dir/b.txt')));
      assert.ok(dirChildren.includes(stringToRel('dir/subdir')));
    });

    it('returns empty array for leaf file', () => {
      const localIndex = createIndex([
        [stringToRel('file.txt'), file('hash')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, createIndex([]));

      const children = state.getChildren(ws, stringToRel('file.txt'));
      assert.deepEqual(children, []);
    });

    it('merges local and remote children', () => {
      const localIndex = createIndex([
        [stringToRel('dir/local.txt'), file('L')],
      ]);
      const remoteIndex = createIndex([
        [stringToRel('dir/remote.txt'), file('R')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, remoteIndex);

      const children = state.getChildren(ws, stringToRel('dir'));
      assert.equal(children.length, 2);
      assert.ok(children.includes(stringToRel('dir/local.txt')));
      assert.ok(children.includes(stringToRel('dir/remote.txt')));
    });
  });

  describe('getLocalMeta / getRemoteMeta', () => {
    it('getLocalMeta returns metadata for existing file', () => {
      const localIndex = createIndex([
        [stringToRel('file.txt'), file('hash123', 1024, 1234567890)],
      ]);

      state.setLocalIndex(ws, localIndex);

      const meta = state.getLocalMeta(ws, stringToRel('file.txt'));
      assert.equal(meta?.type, 'file');
      assert.equal(meta?.hash, 'hash123');
      if (meta?.type === 'file') {
        assert.equal(meta.size, 1024);
        assert.equal(meta.mtimeMs, 1234567890);
      }
    });

    it('getRemoteMeta returns metadata for existing file', () => {
      const remoteIndex = createIndex([
        [stringToRel('file.txt'), file('remoteHash')],
      ]);

      state.setRemoteIndex(ws, remoteIndex);

      const meta = state.getRemoteMeta(ws, stringToRel('file.txt'));
      assert.equal(meta?.type, 'file');
      assert.equal(meta?.hash, 'remoteHash');
    });

    it('returns undefined for non-existent paths', () => {
      state.setLocalIndex(ws, createIndex([]));
      state.setRemoteIndex(ws, createIndex([]));

      assert.equal(state.getLocalMeta(ws, stringToRel('missing.txt')), undefined);
      assert.equal(state.getRemoteMeta(ws, stringToRel('missing.txt')), undefined);
    });
  });

  describe('getLocalIndex / getRemoteIndex', () => {
    it('returns shallow copy of local index', () => {
      const localIndex = createIndex([
        [stringToRel('a.txt'), file('A')],
        [stringToRel('b.txt'), file('B')],
      ]);

      state.setLocalIndex(ws, localIndex);

      const retrieved = state.getLocalIndex(ws);
      assert.equal(retrieved.size, 2);
      assert.equal(retrieved.get(stringToRel('a.txt'))?.hash, 'A');
      assert.equal(retrieved.get(stringToRel('b.txt'))?.hash, 'B');

      // Verify it's a copy (create new map to test independence)
      const retrievedAgain = state.getLocalIndex(ws);
      assert.equal(retrievedAgain.size, 2);
      assert.notStrictEqual(retrieved, retrievedAgain, 'should return different map instances');
    });

    it('returns shallow copy of remote index', () => {
      const remoteIndex = createIndex([
        [stringToRel('x.txt'), file('X')],
      ]);

      state.setRemoteIndex(ws, remoteIndex);

      const retrieved = state.getRemoteIndex(ws);
      assert.equal(retrieved.size, 1);
      assert.equal(retrieved.get(stringToRel('x.txt'))?.hash, 'X');
    });
  });

  describe('hasLocalEntry / hasLocalChildren', () => {
    it('hasLocalEntry returns true for existing file', () => {
      const localIndex = createIndex([
        [stringToRel('file.txt'), file('hash')],
      ]);

      state.setLocalIndex(ws, localIndex);

      assert.equal(state.hasLocalEntry(ws, stringToRel('file.txt')), true);
      assert.equal(state.hasLocalEntry(ws, stringToRel('missing.txt')), false);
    });

    it('hasLocalChildren returns true when folder has descendants', () => {
      const localIndex = createIndex([
        [stringToRel('dir/file.txt'), file('hash')],
      ]);

      state.setLocalIndex(ws, localIndex);

      assert.equal(state.hasLocalChildren(ws, stringToRel('dir')), true);
      assert.equal(state.hasLocalChildren(ws, stringToRel('emptydir')), false);
    });
  });

  describe('Event Emission', () => {
    it('emits change event with parent path on applyLocal', () => {
      const localIndex = createIndex([
        [stringToRel('folder/file.txt'), file('oldHash')],
      ]);

      state.setLocalIndex(ws, localIndex);
      state.setRemoteIndex(ws, createIndex([]));

      let lastEvent: any = null;
      state.subscribeToDiffChanges((event: any) => {
        lastEvent = event;
      });

      state.applyLocal({
        workspaceId: ws,
        type: 'modify',
        path: stringToRel('folder/file.txt'),
        meta: file('newHash'),
      });

      assert.ok(lastEvent);
      assert.equal(lastEvent.workspaceId, ws);
      assert.equal(lastEvent.parentPath, stringToRel('folder'));
      assert.equal(lastEvent.changedPath, stringToRel('folder/file.txt'));
    });

    it('can unsubscribe from events', () => {
      state.setLocalIndex(ws, createIndex([
        [stringToRel('a.txt'), file('A')],
      ]));

      let emitCount = 0;
      const unsubscribe = state.subscribeToDiffChanges(() => {
        emitCount++;
      });

      state.applyLocal({
        workspaceId: ws,
        type: 'modify',
        path: stringToRel('a.txt'),
        meta: file('A2'),
      });

      assert.equal(emitCount, 1);

      unsubscribe();

      state.applyLocal({
        workspaceId: ws,
        type: 'modify',
        path: stringToRel('a.txt'),
        meta: file('A3'),
      });

      assert.equal(emitCount, 1, 'should not emit after unsubscribe');
    });
  });

  describe('Multi-Workspace Support', () => {
    it('maintains separate state per workspace', () => {
      const ws1 = stringToWsId('/workspace1');
      const ws2 = stringToWsId('/workspace2');

      state.setLocalIndex(ws1, createIndex([
        [stringToRel('file1.txt'), file('hash1')],
      ]));

      state.setLocalIndex(ws2, createIndex([
        [stringToRel('file2.txt'), file('hash2')],
      ]));

      const ws1Entries = state.getDiffEntries(ws1);
      const ws2Entries = state.getDiffEntries(ws2);

      assert.equal(ws1Entries.size, 1);
      assert.equal(ws2Entries.size, 1);
      assert.ok(ws1Entries.has(stringToRel('file1.txt')));
      assert.ok(ws2Entries.has(stringToRel('file2.txt')));
      assert.ok(!ws1Entries.has(stringToRel('file2.txt')));
      assert.ok(!ws2Entries.has(stringToRel('file1.txt')));
    });
  });
});