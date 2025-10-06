import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../src/domain/diff/DiffEngine';
import { FileMeta } from '../../src/domain/types';

const file = (overrides: Partial<FileMeta> = {}): FileMeta => {
  return { type: 'file', ...overrides };
};

describe('DefaultDiffEngine (hash-only)', () => {
  it('classifies added / removed / modified / unchanged', () => {
    const engine = new DefaultDiffEngine();

    const localIndex = new Map<string, FileMeta>([
      ['a.txt', file({ hash: '1' })],
      ['b.txt', file({ hash: 'X' })],
      ['same.txt', file({ hash: 'S' })]
    ]);

    const remoteIndex = new Map<string, FileMeta>([
      ['b.txt', file({ hash: 'Y' })],
      ['c.txt', file({ hash: '3' })],
      ['same.txt', file({ hash: 'S' })]
    ]);

    const diffMap = engine.computeFull(localIndex, remoteIndex);

    assert.equal(diffMap.get('a.txt')!.status, 'added');
    assert.equal(diffMap.get('b.txt')!.status, 'modified');
    assert.equal(diffMap.get('c.txt')!.status, 'removed');
    assert.equal(diffMap.get('same.txt')!.status, 'unchanged');
  });

  it('treats missing hash on either side as modified', () => {
    const engine = new DefaultDiffEngine();
    const localIndex = new Map<string, FileMeta>([['x', file({ /* no hash */ })]]);
    const remoteIndex = new Map<string, FileMeta>([['x', file({ hash: 'H' })]]);
    const diffMap = engine.computeFull(localIndex, remoteIndex);
    assert.equal(diffMap.get('x')!.status, 'modified');
  });

  it('type change file↔folder yields modified', () => {
    const engine = new DefaultDiffEngine();
    const localIndex = new Map<string, FileMeta>([['dir', { type: 'folder', hash: 'D' }]]);
    const remoteIndex = new Map<string, FileMeta>([['dir', { type: 'file', hash: 'D' }]]);
    const diffMap = engine.computeFull(localIndex, remoteIndex);
    assert.equal(diffMap.get('dir')!.status, 'modified');
  });
});
