import { strict as assert } from 'assert';
import { stringToRel } from '../../../src/infrastructure/helpers/path';
import type { NodeIndex, FileMeta, FolderMeta } from '../../../src/domain/types';
import { DefaultDiffEngine } from '@domain/diff/DiffEngine';

// Helper functions to create test metadata
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

describe('DefaultDiffEngine', () => {
  let engine: DefaultDiffEngine;

  beforeEach(() => {
    engine = new DefaultDiffEngine();
  });

  describe('Empty Indexes', () => {
    it('produces no diffs for empty indexes', () => {
      const local: NodeIndex = new Map();
      const remote: NodeIndex = new Map();
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 0);
    });
  });

  describe('File Status Detection', () => {
    it('detects added files (local only)', () => {
      const local: NodeIndex = new Map([
        [stringToRel('new-file.txt'), file('hash123')]
      ]);
      const remote: NodeIndex = new Map();
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 1);
      const entry = diff.get(stringToRel('new-file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'added');
      assert.equal(entry.type, 'file');
      assert.ok(entry.left);
      assert.equal(entry.right, undefined);
    });

    it('detects removed files (remote only)', () => {
      const local: NodeIndex = new Map();
      const remote: NodeIndex = new Map([
        [stringToRel('deleted-file.txt'), file('hash456')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 1);
      const entry = diff.get(stringToRel('deleted-file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'removed');
      assert.equal(entry.type, 'file');
      assert.equal(entry.left, undefined);
      assert.ok(entry.right);
    });

    it('detects unchanged files (same hash)', () => {
      const local: NodeIndex = new Map([
        [stringToRel('same-file.txt'), file('hashABC')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('same-file.txt'), file('hashABC')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 1);
      const entry = diff.get(stringToRel('same-file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'unchanged');
      assert.equal(entry.type, 'file');
    });

    it('detects modified files (different hash)', () => {
      const local: NodeIndex = new Map([
        [stringToRel('modified-file.txt'), file('hashNEW')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('modified-file.txt'), file('hashOLD')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 1);
      const entry = diff.get(stringToRel('modified-file.txt'));
      assert.ok(entry);
      assert.equal(entry.status, 'modified');
      assert.equal(entry.type, 'file');
    });

    it('detects conflicts (file vs folder)', () => {
      const local: NodeIndex = new Map([
        [stringToRel('conflict'), file('hashXYZ')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('conflict'), folder('folderHash')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 1);
      const entry = diff.get(stringToRel('conflict'));
      assert.ok(entry);
      assert.equal(entry.status, 'conflict');
      // Type should be from either side (implementation dependent)
      assert.ok(entry.type === 'file' || entry.type === 'folder');
    });
  });

  describe('Folder Status Detection', () => {
    it('detects added folders', () => {
      const local: NodeIndex = new Map([
        [stringToRel('new-folder'), folder('folderHash')]
      ]);
      const remote: NodeIndex = new Map();
      
      const diff = engine.compute(local, remote);
      
      const entry = diff.get(stringToRel('new-folder'));
      assert.ok(entry);
      assert.equal(entry.status, 'added');
      assert.equal(entry.type, 'folder');
    });

    it('detects removed folders', () => {
      const local: NodeIndex = new Map();
      const remote: NodeIndex = new Map([
        [stringToRel('old-folder'), folder('folderHash')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      const entry = diff.get(stringToRel('old-folder'));
      assert.ok(entry);
      assert.equal(entry.status, 'removed');
      assert.equal(entry.type, 'folder');
    });

    it('detects unchanged folders (same hash)', () => {
      const local: NodeIndex = new Map([
        [stringToRel('same-folder'), folder('folderHash123')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('same-folder'), folder('folderHash123')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      const entry = diff.get(stringToRel('same-folder'));
      assert.ok(entry);
      assert.equal(entry.status, 'unchanged');
      assert.equal(entry.type, 'folder');
    });

    it('detects modified folders (different hash)', () => {
      const local: NodeIndex = new Map([
        [stringToRel('changed-folder'), folder('newHash')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('changed-folder'), folder('oldHash')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      const entry = diff.get(stringToRel('changed-folder'));
      assert.ok(entry);
      assert.equal(entry.status, 'modified');
      assert.equal(entry.type, 'folder');
    });
  });

  describe('Multiple Files', () => {
    it('handles mix of added, removed, and modified', () => {
      const local: NodeIndex = new Map([
        [stringToRel('added.txt'), file('hash1')],
        [stringToRel('same.txt'), file('hash2')],
        [stringToRel('modified.txt'), file('hashNEW')],
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('removed.txt'), file('hash3')],
        [stringToRel('same.txt'), file('hash2')],
        [stringToRel('modified.txt'), file('hashOLD')],
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 4);
      assert.equal(diff.get(stringToRel('added.txt'))?.status, 'added');
      assert.equal(diff.get(stringToRel('removed.txt'))?.status, 'removed');
      assert.equal(diff.get(stringToRel('same.txt'))?.status, 'unchanged');
      assert.equal(diff.get(stringToRel('modified.txt'))?.status, 'modified');
    });
  });

  describe('Nested Paths', () => {
    it('handles files in subdirectories', () => {
      const local: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('src/utils/helper.ts'), file('hash2')],
      ]);
      const remote: NodeIndex = new Map();
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.size, 2);
      assert.equal(diff.get(stringToRel('src/app.ts'))?.status, 'added');
      assert.equal(diff.get(stringToRel('src/utils/helper.ts'))?.status, 'added');
    });

    it('handles deep nesting', () => {
      const deepPath = 'a/b/c/d/e/f/file.txt';
      const local: NodeIndex = new Map([
        [stringToRel(deepPath), file('deepHash')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel(deepPath), file('deepHash')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.get(stringToRel(deepPath))?.status, 'unchanged');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty hash as modified', () => {
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), file('')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash123')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.get(stringToRel('file.txt'))?.status, 'modified');
    });

    it('handles __unknown__ hash as modified', () => {
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), file('__unknown__')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash123')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.get(stringToRel('file.txt'))?.status, 'modified');
    });

    it('handles both __unknown__ as modified', () => {
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), file('__unknown__')]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('file.txt'), file('__unknown__')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.get(stringToRel('file.txt'))?.status, 'modified');
    });

    it('handles missing hash as modified', () => {
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), { type: 'file' } as FileMeta]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash123')]
      ]);
      
      const diff = engine.compute(local, remote);
      
      assert.equal(diff.get(stringToRel('file.txt'))?.status, 'modified');
    });
  });

  describe('Large Indexes', () => {
    it('handles 100+ files efficiently', () => {
      const local: NodeIndex = new Map();
      const remote: NodeIndex = new Map();
      
      // Add 100 files to each side
      for (let i = 0; i < 100; i++) {
        local.set(stringToRel(`file-${i}.txt`), file(`hash-${i}`));
        remote.set(stringToRel(`file-${i}.txt`), file(`hash-${i}`));
      }
      
      const start = Date.now();
      const diff = engine.compute(local, remote);
      const duration = Date.now() - start;
      
      assert.equal(diff.size, 100);
      assert.ok(duration < 100, `Diff computation took ${duration}ms, expected <100ms`);
      
      // All should be unchanged
      for (let i = 0; i < 100; i++) {
        assert.equal(diff.get(stringToRel(`file-${i}.txt`))?.status, 'unchanged');
      }
    });
  });

  describe('DiffEntry Structure', () => {
    it('includes path in diff entry', () => {
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash1')]
      ]);
      const remote: NodeIndex = new Map();
      
      const diff = engine.compute(local, remote);
      const entry = diff.get(stringToRel('file.txt'));
      
      assert.ok(entry);
      assert.equal(entry.path, 'file.txt');
    });

    it('includes type in diff entry', () => {
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), file('hash1')]
      ]);
      const remote: NodeIndex = new Map();
      
      const diff = engine.compute(local, remote);
      const entry = diff.get(stringToRel('file.txt'));
      
      assert.ok(entry);
      assert.equal(entry.type, 'file');
    });

    it('includes left metadata for added files', () => {
      const fileMeta = file('hash1', 1024, Date.now());
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), fileMeta]
      ]);
      const remote: NodeIndex = new Map();
      
      const diff = engine.compute(local, remote);
      const entry = diff.get(stringToRel('file.txt'));
      
      assert.ok(entry);
      assert.deepEqual(entry.left, fileMeta);
      assert.equal(entry.right, undefined);
    });

    it('includes right metadata for removed files', () => {
      const fileMeta = file('hash1', 2048, Date.now());
      const local: NodeIndex = new Map();
      const remote: NodeIndex = new Map([
        [stringToRel('file.txt'), fileMeta]
      ]);
      
      const diff = engine.compute(local, remote);
      const entry = diff.get(stringToRel('file.txt'));
      
      assert.ok(entry);
      assert.equal(entry.left, undefined);
      assert.deepEqual(entry.right, fileMeta);
    });

    it('includes both left and right for modified files', () => {
      const leftMeta = file('hashNEW', 1024);
      const rightMeta = file('hashOLD', 1024);
      
      const local: NodeIndex = new Map([
        [stringToRel('file.txt'), leftMeta]
      ]);
      const remote: NodeIndex = new Map([
        [stringToRel('file.txt'), rightMeta]
      ]);
      
      const diff = engine.compute(local, remote);
      const entry = diff.get(stringToRel('file.txt'));
      
      assert.ok(entry);
      assert.deepEqual(entry.left, leftMeta);
      assert.deepEqual(entry.right, rightMeta);
    });
  });
});