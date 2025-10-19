import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../src/domain/diff/DiffEngine';
import type { FileMeta } from '../../src/domain/types';

const f = (hash: string): FileMeta => ({ type: 'file', hash });

describe('DefaultDiffEngine.compute', () => {
  it('marks folder unchanged when all descendants unchanged', () => {
    const eng = new DefaultDiffEngine();
    const local = new Map<string, FileMeta>([['a/x.txt', f('1')], ['a/y.txt', f('2')]]);
    const remote = new Map<string, FileMeta>([['a/x.txt', f('1')], ['a/y.txt', f('2')]]);
    const diff = eng.compute!(local, remote);
    assert.equal(diff.get('a')!.type, 'folder');
    assert.equal(diff.get('a')!.status, 'unchanged');
  });

  it('marks folder modified when any descendant differs', () => {
    const eng = new DefaultDiffEngine();
    const local = new Map<string, FileMeta>([['a/x.txt', f('1')], ['a/y.txt', f('2')]]);
    const remote = new Map<string, FileMeta>([['a/x.txt', f('9')], ['a/y.txt', f('2')]]);
    const diff = eng.compute!(local, remote);
    assert.equal(diff.get('a')!.status, 'modified');
  });

  it('marks folder added / removed based on which side has descendants', () => {
    const eng = new DefaultDiffEngine();
    const local = new Map<string, FileMeta>([['b/z.txt', f('Z')]]);
    const remote = new Map<string, FileMeta>();
    const diff1 = eng.compute!(local, remote);
    assert.equal(diff1.get('b')!.status, 'added');

    const diff2 = eng.compute!(remote, local);
    assert.equal(diff2.get('b')!.status, 'removed');
  });

  it('propagates change to parent-of-parent folders', () => {
    const eng = new DefaultDiffEngine();
    const local = new Map<string, FileMeta>([['a/b/c.txt', f('1')]]);
    const remote = new Map<string, FileMeta>([['a/b/c.txt', f('2')]]);
    const diff = eng.compute!(local, remote);
    assert.equal(diff.get('a')!.status, 'modified');
    assert.equal(diff.get('a/b')!.status, 'modified');
  });
});
