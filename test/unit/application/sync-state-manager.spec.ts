import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../../src/domain/diff/DiffEngine';
import { SyncStateManager } from '../../../src/application/SyncStateManager';
import { FileMeta, NodeMeta, RelPath } from '../../../src/domain/types';
import { stringToRel, stringToWsId } from '../../../src/infrastructure/helpers/path';

const fileMeta = (hash: string, overrides: Partial<FileMeta> = {}): FileMeta => {
  return { type: 'file', hash, ...overrides };
};

const createIndex = (entries: Array<[RelPath, NodeMeta]>) => {
  return new Map(entries);
};

describe('SyncStateManager', () => {
  it('computes diff and emits minimal parent refresh', () => {
    const engine = new DefaultDiffEngine();
    const state = new SyncStateManager(engine);

    const workspaceId = stringToWsId('ws1');

    const localIndex = createIndex([
      [stringToRel('a.txt'), fileMeta('1')],
      [stringToRel('folder/x.txt'), fileMeta('X')]
    ]);

    const remoteIndex = createIndex([
      [stringToRel('folder/x.txt'), fileMeta('X')],
      [stringToRel('b.txt'), fileMeta('2')]
    ]);

    let lastEventParent: string | undefined;
    state.subscribeToDiffChanges(({ parentPath }) => {
      lastEventParent = parentPath as string;
    });

    state.setLocalIndex(workspaceId, localIndex);
    state.setRemoteIndex(workspaceId, remoteIndex);

    assert.equal(state.getDiffEntry(workspaceId, stringToRel('a.txt'))!.status, 'added');
    assert.equal(state.getDiffEntry(workspaceId, stringToRel('b.txt'))!.status, 'removed');
    assert.equal(state.getDiffEntry(workspaceId, stringToRel('folder/x.txt'))!.status, 'unchanged');

    state.applyLocal({
      workspaceId,
      type: 'modify',
      path: stringToRel('folder/x.txt'),
      meta: fileMeta('NEW')
    });

    assert.equal(state.getDiffEntry(workspaceId, stringToRel('folder/x.txt'))!.status, 'modified');
    assert.equal(lastEventParent, 'folder');
  });
});