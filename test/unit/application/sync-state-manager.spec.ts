import { strict as assert } from 'assert';
import { SyncStateManager } from '../../../src/application/SyncStateManager';
import { stringToWsId, stringToRel } from '../../../src/infrastructure/helpers/path';
import type { NodeIndex, FileMeta, FolderMeta, RelPath, NodeMeta } from '../../../src/domain/types';
import { DefaultDiffEngine } from '@domain/diff/DiffEngine';

// Helper functions
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

describe('SyncStateManager', () => {
  let state: SyncStateManager;
  const wsId = stringToWsId('/test-workspace');

  beforeEach(() => {
    const engine = new DefaultDiffEngine();
    state = new SyncStateManager(engine);
  });

  describe('Initial State', () => {
    it('returns undefined for entries in empty workspace', () => {
      const entry = state.getDiffEntry(wsId, stringToRel('nonexistent.txt'));
      assert.equal(entry, undefined);
    });

    it('getChildren returns empty array for empty workspace', () => {
      const children = state.getChildren(wsId, stringToRel(''));
      assert.deepEqual(children, []);
    });

    it('getDiffEntries returns empty map for empty workspace', () => {
      const entries = state.getDiffEntries(wsId);
      assert.equal(entries.size, 0);
    });
  });

  describe('Index Management', () => {
    it('setLocalIndex triggers diff recompute', () => {
      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      const localIndex: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash123')]
      ] as [RelPath, NodeMeta][]);

      state.setLocalIndex(wsId, localIndex);
      
      assert.equal(emitCount, 1, 'should emit once after setLocalIndex');
      
      const entry = state.getDiffEntry(wsId, stringToRel('file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'added');
    });

    it('setRemoteIndex triggers diff recompute', () => {
      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      const remoteIndex: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash456')]
      ] as [RelPath, NodeMeta][]);

      state.setRemoteIndex(wsId, remoteIndex);
      
      assert.equal(emitCount, 1, 'should emit once after setRemoteIndex');
      
      const entry = state.getDiffEntry(wsId, stringToRel('file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'removed');
    });

    it('setting both indexes computes correct diff', () => {
      const localIndex: NodeIndex = new Map([
        [stringToRel('same.txt'), file('hashX')],
        [stringToRel('local-only.txt'), file('hashL')],
      ] as [RelPath, NodeMeta][]);

      const remoteIndex: NodeIndex = new Map([
        [stringToRel('same.txt'), file('hashX')],
        [stringToRel('remote-only.txt'), file('hashR')],
      ] as [RelPath, NodeMeta][]);

      state.setLocalIndex(wsId, localIndex);
      state.setRemoteIndex(wsId, remoteIndex);

      const entries = state.getDiffEntries(wsId);
      assert.equal(entries.size, 3);
      
      assert.equal(state.getDiffEntry(wsId, stringToRel('same.txt'))?.status, 'unchanged');
      assert.equal(state.getDiffEntry(wsId, stringToRel('local-only.txt'))?.status, 'added');
      assert.equal(state.getDiffEntry(wsId, stringToRel('remote-only.txt'))?.status, 'removed');
    });
  });

  describe('Event Subscriptions', () => {
    it('subscribeToDiffChanges emits on changes', () => {
      let emitCount = 0;
      let lastWorkspace: string | undefined;

      state.subscribeToDiffChanges((event) => {
        emitCount++;
        lastWorkspace = event.workspaceId as string;
      });

      const localIndex: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash1')]
      ] as [RelPath, NodeMeta][]);

      state.setLocalIndex(wsId, localIndex);

      assert.equal(emitCount, 1);
      assert.equal(lastWorkspace, wsId);
    });

    it('emits separate events for different workspaces', () => {
      const ws1 = stringToWsId('/workspace-1');
      const ws2 = stringToWsId('/workspace-2');

      const emissions: string[] = [];
      state.subscribeToDiffChanges((event) => {
        emissions.push(event.workspaceId as string);
      });

      state.setLocalIndex(ws1, new Map([[stringToRel('file1.txt'), file('hash1')]] as [RelPath, NodeMeta][]));
      state.setLocalIndex(ws2, new Map([[stringToRel('file2.txt'), file('hash2')]] as [RelPath, NodeMeta][]));

      assert.equal(emissions.length, 2);
      assert.ok(emissions.includes(ws1));
      assert.ok(emissions.includes(ws2));
    });

    it('multiple subscribers all receive events', () => {
      let count1 = 0;
      let count2 = 0;

      state.subscribeToDiffChanges(() => { count1++; });
      state.subscribeToDiffChanges(() => { count2++; });

      state.setLocalIndex(wsId, new Map([[stringToRel('file.txt'), file('hash')]]));

      assert.equal(count1, 1);
      assert.equal(count2, 1);
    });
  });

  describe('applyLocal', () => {
    it('updates local index and triggers diff', () => {
      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      state.applyLocal({
        workspaceId: wsId,
        type: 'modify',
        path: stringToRel('file.txt'),
        meta: file('newHash')
      });

      assert.equal(emitCount, 1);
      
      const entry = state.getDiffEntry(wsId, stringToRel('file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'added');
    });

    it('delete removes from local index', () => {
      // Set initial state
      state.setLocalIndex(wsId, new Map([
        [stringToRel('file.txt'), file('hash1')]
      ] as [RelPath, NodeMeta][]));

      // Delete it
      state.applyLocal({
        workspaceId: wsId,
        type: 'delete',
        path: stringToRel('file.txt')
      });

      const entry = state.getDiffEntry(wsId, stringToRel('file.txt'));
      assert.equal(entry, undefined);
    });
  });

  describe('applyRemote', () => {
    it('updates remote index and triggers diff', () => {
      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      state.applyRemote({
        workspaceId: wsId,
        type: 'modify',
        path: stringToRel('file.txt'),
        meta: file('remoteHash')
      });

      assert.equal(emitCount, 1);
      
      const entry = state.getDiffEntry(wsId, stringToRel('file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'removed');
    });

    it('delete removes from remote index', () => {
      // Set initial state
      state.setRemoteIndex(wsId, new Map([
        [stringToRel('file.txt'), file('hash1')]
      ] as [RelPath, NodeMeta][]));

      // Delete it
      state.applyRemote({
        workspaceId: wsId,
        type: 'delete',
        path: stringToRel('file.txt')
      });

      const entry = state.getDiffEntry(wsId, stringToRel('file.txt'));
      assert.equal(entry, undefined);
    });
  });

  describe('runBatch', () => {
    it('batches multiple updates into single event', () => {
      let emitCount = 0;
      state.subscribeToDiffChanges(() => { emitCount++; });

      state.runBatch(wsId, undefined as any, () => {
        state.applyLocal({ workspaceId: wsId, type: 'modify', path: stringToRel('file1.txt'), meta: file('hash1') });
        state.applyLocal({ workspaceId: wsId, type: 'modify', path: stringToRel('file2.txt'), meta: file('hash2') });
        state.applyLocal({ workspaceId: wsId, type: 'modify', path: stringToRel('file3.txt'), meta: file('hash3') });
      });

      assert.equal(emitCount, 1, 'should emit only once for batched operations');
      
      assert.ok(state.getDiffEntry(wsId, stringToRel('file1.txt')));
      assert.ok(state.getDiffEntry(wsId, stringToRel('file2.txt')));
      assert.ok(state.getDiffEntry(wsId, stringToRel('file3.txt')));
    });

    it('emits after batch completes', () => {
      let emitCount = 0;
      let entriesWhenEmitted = 0;

      state.subscribeToDiffChanges(() => {
        emitCount++;
        entriesWhenEmitted = state.getDiffEntries(wsId).size;
      });

      state.runBatch(wsId, undefined as any, () => {
        state.applyLocal({ workspaceId: wsId, type: 'modify', path: stringToRel('file1.txt'), meta: file('hash1') });
        state.applyLocal({ workspaceId: wsId, type: 'modify', path: stringToRel('file2.txt'), meta: file('hash2') });
      });

      assert.equal(emitCount, 1);
      assert.equal(entriesWhenEmitted, 2, 'all updates should be visible when event fires');
    });
  });

  describe('getChildren', () => {
    it('returns immediate children only', () => {
      const localIndex: NodeIndex = new Map([
        [stringToRel('src'), folder('folderHash')],
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('src/utils'), folder('folderHash2')],
        [stringToRel('src/utils/helper.ts'), file('hash2')],
        [stringToRel('README.md'), file('hash3')],
      ] as [RelPath, NodeMeta][]);

      state.setLocalIndex(wsId, localIndex);

      const rootChildren = state.getChildren(wsId, stringToRel(''));
      assert.equal(rootChildren.length, 2); // src and README.md
      assert.ok(rootChildren.includes('src' as any));
      assert.ok(rootChildren.includes('README.md' as any));

      const srcChildren = state.getChildren(wsId, stringToRel('src'));
      assert.equal(srcChildren.length, 2); // app.ts and utils
      assert.ok(srcChildren.includes('src/app.ts' as any));
      assert.ok(srcChildren.includes('src/utils' as any));
    });

    it('returns empty array for non-existent path', () => {
      const children = state.getChildren(wsId, stringToRel('nonexistent'));
      assert.deepEqual(children, []);
    });
  });

  describe('Conflict Ignore Tracking', () => {
    it('markConflictIgnored tracks ignored conflicts', () => {
      state.markConflictIgnored(wsId, stringToRel('file.txt'), 'remote-modified', 'Test reason');
      
      const isIgnored = state.isConflictIgnored(wsId, stringToRel('file.txt'));
      assert.equal(isIgnored, true);
    });

    it('isConflictIgnored returns false for non-ignored paths', () => {
      const isIgnored = state.isConflictIgnored(wsId, stringToRel('file.txt'));
      assert.equal(isIgnored, false);
    });

    it('clearIgnoredConflict removes from tracking', () => {
      state.markConflictIgnored(wsId, stringToRel('file.txt'), 'remote-modified', 'Test');
      assert.equal(state.isConflictIgnored(wsId, stringToRel('file.txt')), true);
      
      state.clearIgnoredConflict(wsId, stringToRel('file.txt'));
      assert.equal(state.isConflictIgnored(wsId, stringToRel('file.txt')), false);
    });
  });

  describe('Multiple Workspaces', () => {
    it('keeps workspaces isolated', () => {
      const ws1 = stringToWsId('/workspace-1');
      const ws2 = stringToWsId('/workspace-2');

      state.setLocalIndex(ws1, new Map([[stringToRel('file1.txt'), file('hash1')]] as [RelPath, NodeMeta][]));
      state.setLocalIndex(ws2, new Map([[stringToRel('file2.txt'), file('hash2')]] as [RelPath, NodeMeta][]));

      assert.equal(state.getDiffEntries(ws1).size, 1);
      assert.equal(state.getDiffEntries(ws2).size, 1);
      
      assert.ok(state.getDiffEntry(ws1, stringToRel('file1.txt')));
      assert.equal(state.getDiffEntry(ws1, stringToRel('file2.txt')), undefined);
      
      assert.ok(state.getDiffEntry(ws2, stringToRel('file2.txt')));
      assert.equal(state.getDiffEntry(ws2, stringToRel('file1.txt')), undefined);
    });

    it('emits events only for modified workspace', () => {
      const ws1 = stringToWsId('/workspace-1');
      const ws2 = stringToWsId('/workspace-2');

      const emissions: string[] = [];
      state.subscribeToDiffChanges((event) => {
        emissions.push(event.workspaceId as string);
      });

      state.setLocalIndex(ws1, new Map([[stringToRel('file.txt'), file('hash1')]] as [RelPath, NodeMeta][]));

      assert.equal(emissions.length, 1);
      assert.equal(emissions[0], ws1);
      assert.ok(!emissions.includes(ws2));
    });
  });

  describe('getDiffEntry', () => {
    it('returns entry for existing path', () => {
      state.setLocalIndex(wsId, new Map([
        [stringToRel('file.txt'), file('hash123')]
      ] as [RelPath, NodeMeta][]));

      const entry = state.getDiffEntry(wsId, stringToRel('file.txt'));
      
      assert.ok(entry);
      assert.equal(entry.path, 'file.txt');
      assert.equal(entry.status, 'added');
      assert.equal(entry.type, 'file');
    });

    it('returns undefined for non-existent path', () => {
      const entry = state.getDiffEntry(wsId, stringToRel('nonexistent.txt'));
      assert.equal(entry, undefined);
    });
  });

  describe('getDiffEntries', () => {
    it('returns all diff entries for workspace', () => {
      const localIndex: NodeIndex = new Map([
        [stringToRel('file1.txt'), file('hash1')],
        [stringToRel('file2.txt'), file('hash2')],
        [stringToRel('file3.txt'), file('hash3')],
      ] as [RelPath, NodeMeta][]);

      state.setLocalIndex(wsId, localIndex);

      const entries = state.getDiffEntries(wsId);
      
      assert.equal(entries.size, 3);
      assert.ok(entries.has(stringToRel('file1.txt')));
      assert.ok(entries.has(stringToRel('file2.txt')));
      assert.ok(entries.has(stringToRel('file3.txt')));
    });

    it('returns empty map for workspace with no diffs', () => {
      const entries = state.getDiffEntries(wsId);
      assert.equal(entries.size, 0);
    });
  });
});