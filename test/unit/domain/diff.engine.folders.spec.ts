import { strict as assert } from 'assert';
import { DefaultDiffEngine } from '../../../src/domain/diff/DiffEngine';
import { FileMeta, FolderMeta, NodeMeta, RelPath } from '../../../src/domain/types';
import { stringToRel } from '../../../src/infrastructure/helpers/path';

const file = (hash: string): FileMeta => ({ type: 'file', hash });
const folder = (hash: string = ''): FolderMeta => ({ type: 'folder', hash });

const createIndex = (entries: Array<[RelPath, NodeMeta]>) => {
  return new Map(entries);
};

describe('DefaultDiffEngine.compute', () => {
  it('marks folder unchanged when all descendants unchanged', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([
      [stringToRel('a'), folder('hash1')],  // Add explicit folder entry
      [stringToRel('a/x.txt'), file('1')], 
      [stringToRel('a/y.txt'), file('2')]
    ]);
    const remote = createIndex([
      [stringToRel('a'), folder('hash1')],  // Add explicit folder entry
      [stringToRel('a/x.txt'), file('1')], 
      [stringToRel('a/y.txt'), file('2')]
    ]);
    const diff = eng.compute(local, remote);
    const entry = diff.get(stringToRel('a'));
    assert.ok(entry, 'folder entry should exist');
    assert.equal(entry.type, 'folder');
    assert.equal(entry.status, 'unchanged');
  });

  it('marks folder modified when any descendant differs', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([
      [stringToRel('a'), folder('hash1')],  // Add explicit folder entry
      [stringToRel('a/x.txt'), file('1')], 
      [stringToRel('a/y.txt'), file('2')]
    ]);
    const remote = createIndex([
      [stringToRel('a'), folder('hash2')],  // Different hash
      [stringToRel('a/x.txt'), file('9')], 
      [stringToRel('a/y.txt'), file('2')]
    ]);
    const diff = eng.compute(local, remote);
    const entry = diff.get(stringToRel('a'));
    assert.ok(entry, 'folder entry should exist');
    assert.equal(entry.status, 'modified');
  });

  it('marks folder added / removed based on which side has descendants', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([
      [stringToRel('b'), folder('hashB')],  // Add explicit folder entry
      [stringToRel('b/z.txt'), file('Z')]
    ]);
    const remote = createIndex([]);
    
    const diff1 = eng.compute(local, remote);
    const entry1 = diff1.get(stringToRel('b'));
    assert.ok(entry1, 'folder entry should exist in diff1');
    assert.equal(entry1.status, 'added');

    const diff2 = eng.compute(remote, local);
    const entry2 = diff2.get(stringToRel('b'));
    assert.ok(entry2, 'folder entry should exist in diff2');
    assert.equal(entry2.status, 'removed');
  });

  it('propagates change to parent-of-parent folders', () => {
    const eng = new DefaultDiffEngine();
    const local = createIndex([
      [stringToRel('a'), folder('hashA1')],
      [stringToRel('a/b'), folder('hashB1')],
      [stringToRel('a/b/c.txt'), file('1')]
    ]);
    const remote = createIndex([
      [stringToRel('a'), folder('hashA2')],  // Different hash
      [stringToRel('a/b'), folder('hashB2')],  // Different hash
      [stringToRel('a/b/c.txt'), file('2')]
    ]);
    const diff = eng.compute(local, remote);
    
    const entryA = diff.get(stringToRel('a'));
    const entryB = diff.get(stringToRel('a/b'));
    
    assert.ok(entryA, 'folder a should exist');
    assert.ok(entryB, 'folder a/b should exist');
    assert.equal(entryA.status, 'modified');
    assert.equal(entryB.status, 'modified');
  });
});