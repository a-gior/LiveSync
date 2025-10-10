import { strict as assert } from 'assert';
import { collectTargetsRecursive } from '../../src/presentation/tree/collectTargets';

const file = (status: any) => ({ type: 'file', status });
const dir  = (status: any) => ({ type: 'folder', status });

describe('collectTargetsRecursive', () => {
  const diff = new Map<string, any>([
    ['a.txt', file('modified')],
    ['b.txt', file('added')],
    ['dir',    dir('modified')],
    ['dir/x.txt', file('removed')],
    ['dir/y.txt', file('modified')],
    ['dir/sub', dir('modified')],
    ['dir/sub/z.txt', file('conflict')],
  ]);

  it('root scope: returns all files passing predicate', () => {
    const r = collectTargetsRecursive(diff, undefined, e => e.status === 'modified' || e.status === 'conflict');
    r.sort();
    assert.deepEqual(r, ['a.txt', 'dir/sub/z.txt', 'dir/y.txt']);
  });

  it('folder scope: includes folder itself and descendants', () => {
    const r = collectTargetsRecursive(diff, 'dir', e => e.status === 'removed' || e.status === 'modified');
    r.sort();
    assert.deepEqual(r, ['dir/x.txt', 'dir/y.txt']);
  });
});
