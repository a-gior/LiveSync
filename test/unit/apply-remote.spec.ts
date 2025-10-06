import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../src/domain/diff/DiffEngine';
import { SyncStateManager } from '../../src/application/SyncStateManager';
import type { FileMeta, DiffEntry } from '../../src/domain/types';

const file = (hash: string): FileMeta => ({ type: 'file', hash });

describe('SyncStateManager — applyRemote flows', () => {
  const workspaceId = '/ws';

  function getStatus(map: Map<string, DiffEntry>, path: string): DiffEntry['status'] {
    const entry = map.get(path);
    if (!entry) {
      throw new Error(`Missing diff entry for ${path}`);
    }
    return entry.status;
  }

  it('resolves "added" (local-only) by remote modify (upload) → unchanged', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);

    // local has a.txt, remote empty
    state.setLocalIndex(workspaceId, new Map([['a.txt', file('L')]]));
    state.setRemoteIndex(workspaceId, new Map());

    let diff = state.getDiffEntries(workspaceId);
    assert.equal(getStatus(diff, 'a.txt'), 'added');

    // simulate remote upload: remote.modify(path, localMeta)
    state.applyRemote({
      workspaceId,
      type: 'modify',
      path: 'a.txt',
      meta: file('L')
    });

    diff = state.getDiffEntries(workspaceId);
    assert.equal(getStatus(diff, 'a.txt'), 'unchanged');
  });

  it('resolves "removed" (remote-only) by remote delete → unchanged (file disappears from diff)', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);

    state.setLocalIndex(workspaceId, new Map());
    state.setRemoteIndex(workspaceId, new Map([['b.txt', file('R')]]));

    let diff = state.getDiffEntries(workspaceId);
    assert.equal(getStatus(diff, 'b.txt'), 'removed');

    state.applyRemote({
      workspaceId,
      type: 'delete',
      path: 'b.txt'
    });

    diff = state.getDiffEntries(workspaceId);
    // b.txt gone from diff entirely
    assert.equal(diff.has('b.txt'), false);
  });

  it('resolves "modified" by remote modify with local meta → unchanged', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);

    state.setLocalIndex(workspaceId, new Map([['c.txt', file('L')]]));
    state.setRemoteIndex(workspaceId, new Map([['c.txt', file('R')]]));

    let diff = state.getDiffEntries(workspaceId);
    assert.equal(getStatus(diff, 'c.txt'), 'modified');

    state.applyRemote({
      workspaceId,
      type: 'modify',
      path: 'c.txt',
      meta: file('L')
    });

    diff = state.getDiffEntries(workspaceId);
    assert.equal(getStatus(diff, 'c.txt'), 'unchanged');
  });

  it('runBatch defers recompute → single emission for multi-file applyRemote', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);

    // prepare 3 modified files
    state.setLocalIndex(workspaceId, new Map([
      ['d/1.txt', file('A')],
      ['d/2.txt', file('A')],
      ['d/3.txt', file('A')],
    ]));
    state.setRemoteIndex(workspaceId, new Map([
      ['d/1.txt', file('B')],
      ['d/2.txt', file('B')],
      ['d/3.txt', file('B')],
    ]));

    let emitCount = 0;
    state.subscribeToDiffChanges(() => { emitCount += 1; });

    // apply all in one batch
    state.runBatch(workspaceId, 'd', () => {
      for (const name of ['d/1.txt', 'd/2.txt', 'd/3.txt']) {
        state.applyRemote({
          workspaceId,
          type: 'modify',
          path: name,
          meta: file('A')
        });
      }
    });

    const diff = state.getDiffEntries(workspaceId);
    for (const name of ['d/1.txt', 'd/2.txt', 'd/3.txt']) {
      assert.equal(getStatus(diff, name), 'unchanged');
    }
    assert.equal(emitCount, 1, 'expected a single diff change emission after batch');
  });
});
