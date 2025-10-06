import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../src/domain/diff/DiffEngine';
import { SyncStateManager } from '../../src/application/SyncStateManager';
import type { FileMeta, DiffEntry } from '../../src/domain/types';

const file = (hash: string): FileMeta => ({ type: 'file', hash });
const statusOf = (m: Map<string, DiffEntry>, p: string) => {
  const e = m.get(p);
  if (!e) { throw new Error('missing ' + p); }
  return e.status;
};

describe('SyncStateManager — applyRemote batching', () => {
  const ws = '/ws';

  it('single-file transitions to unchanged', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);
    state.setLocalIndex(ws, new Map([['a.txt', file('L')]]));
    state.setRemoteIndex(ws, new Map([['a.txt', file('R')]]));

    let diff = state.getDiffEntries(ws);
    assert.equal(statusOf(diff, 'a.txt'), 'modified');

    state.applyRemote({ workspaceId: ws, type: 'modify', path: 'a.txt', meta: file('L') });
    diff = state.getDiffEntries(ws);
    assert.equal(statusOf(diff, 'a.txt'), 'unchanged');
  });

  it('runBatch collapses multiple emits into one', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);

    state.setLocalIndex(ws, new Map([
      ['d/1.txt', file('A')],
      ['d/2.txt', file('A')],
      ['d/3.txt', file('A')],
    ]));
    state.setRemoteIndex(ws, new Map([
      ['d/1.txt', file('B')],
      ['d/2.txt', file('B')],
      ['d/3.txt', file('B')],
    ]));

    let emits = 0;
    state.subscribeToDiffChanges(() => { emits += 1; });

    state.runBatch(ws, 'd', () => {
      for (const p of ['d/1.txt', 'd/2.txt', 'd/3.txt']) {
        state.applyRemote({ workspaceId: ws, type: 'modify', path: p, meta: file('A') });
      }
    });

    const diff = state.getDiffEntries(ws);
    for (const p of ['d/1.txt', 'd/2.txt', 'd/3.txt']) {
      assert.equal(statusOf(diff, p), 'unchanged');
    }
    assert.equal(emits, 1, 'expected a single emission');
  });
});
