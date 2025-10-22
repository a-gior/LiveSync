import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../../src/domain/diff/DiffEngine';
import { FileMeta, NodeMeta, RelPath } from '../../../src/domain/types';
import { stringToRel } from '../../../src/infrastructure/helpers/path';

const f = (hash: string): FileMeta => ({ type: 'file', hash });

const createIndex = (entries: Array<[RelPath, NodeMeta]>) => {
  return new Map(entries);
};

describe('DefaultDiffEngine.compute', () => {
  it('marks folder unchanged when all descendants unchanged', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([
      [stringToRel('a/x.txt'), f('1')], 
      [stringToRel('a/y.txt'), f('2')]
    ]);
    const remote = createIndex([
      [stringToRel('a/x.txt'), f('1')], 
      [stringToRel('a/y.txt'), f('2')]
    ]);
    const diff = eng.compute(local, remote);
    assert.equal(diff.get(stringToRel('a'))!.type, 'folder');
    assert.equal(diff.get(stringToRel('a'))!.status, 'unchanged');
  });

  it('marks folder modified when any descendant differs', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([
      [stringToRel('a/x.txt'), f('1')], 
      [stringToRel('a/y.txt'), f('2')]
    ]);
    const remote = createIndex([
      [stringToRel('a/x.txt'), f('9')], 
      [stringToRel('a/y.txt'), f('2')]
    ]);
    const diff = eng.compute(local, remote);
    assert.equal(diff.get(stringToRel('a'))!.status, 'modified');
  });

  it('marks folder added / removed based on which side has descendants', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([[stringToRel('b/z.txt'), f('Z')]]);
    const remote = createIndex([]);
    const diff1 = eng.compute(local, remote);
    assert.equal(diff1.get(stringToRel('b'))!.status, 'added');

    const diff2 = eng.compute(remote, local);
    assert.equal(diff2.get(stringToRel('b'))!.status, 'removed');
  });

  it('propagates change to parent-of-parent folders', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([[stringToRel('a/b/c.txt'), f('1')]]);
    const remote = createIndex([[stringToRel('a/b/c.txt'), f('2')]]);
    const diff = eng.compute(local, remote);
    assert.equal(diff.get(stringToRel('a'))!.status, 'modified');
    assert.equal(diff.get(stringToRel('a/b'))!.status, 'modified');
  });
});