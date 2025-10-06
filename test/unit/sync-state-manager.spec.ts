import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../src/domain/diff/DiffEngine';
import { SyncStateManager } from '../../src/application/SyncStateManager';
import { FileMeta } from '../../src/domain/types';

const fileMeta = (overrides: Partial<FileMeta> = {}): FileMeta => {
  return { type: 'file', ...overrides };
};

describe('SyncStateManager', () => {
  it('computes diff and emits minimal parent refresh', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);

    const workspaceId = 'ws1';

    const localIndex = new Map<string, FileMeta>([
      ['a.txt', fileMeta({ hash: '1' })],
      ['folder/x.txt', fileMeta({ hash: 'X' })]
    ]);

    const remoteIndex = new Map<string, FileMeta>([
      ['folder/x.txt', fileMeta({ hash: 'X' })],
      ['b.txt', fileMeta({ hash: '2' })]
    ]);

    let lastEventParent: string | undefined;
    state.subscribeToDiffChanges(({ parentPath }) => {
      lastEventParent = parentPath;
    });

    state.setLocalIndex(workspaceId, localIndex);
    state.setRemoteIndex(workspaceId, remoteIndex);

    assert.equal(state.getDiffEntry(workspaceId, 'a.txt')!.status, 'added');
    assert.equal(state.getDiffEntry(workspaceId, 'b.txt')!.status, 'removed');
    assert.equal(state.getDiffEntry(workspaceId, 'folder/x.txt')!.status, 'unchanged');

    state.applyLocal({
      workspaceId,
      type: 'modify',
      path: 'folder/x.txt',
      meta: fileMeta({ hash: 'NEW' })
    });

    assert.equal(state.getDiffEntry(workspaceId, 'folder/x.txt')!.status, 'modified');
    assert.equal(lastEventParent, 'folder');
  });
});
