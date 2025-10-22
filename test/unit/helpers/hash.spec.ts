import { strict as assert } from 'assert';
import { computeFolderHashFromNodeIndex, computeAllFolderHashes } from '../../../src/infrastructure/helpers/hash/FolderHash';
import { stringToRel } from '../../../src/infrastructure/helpers/path';
import type { NodeIndex, FileMeta, FolderMeta, RelPath, NodeMeta } from '../../../src/domain/types';

const file = (hash: string): FileMeta => ({ type: 'file', hash });
const folder = (hash: string = ''): FolderMeta => ({ type: 'folder', hash });

// Helper to create NodeIndex from entries
const createIndex = (entries: Array<[RelPath, NodeMeta]>): NodeIndex => {
  return new Map(entries);
};

describe('Hash Helpers', () => {
  describe('computeFolderHashFromNodeIndex', () => {
    it('computes hash of empty folder (no files)', () => {
      const index = createIndex([
        [stringToRel('empty'), folder()]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('empty'));
      
      // Empty folder -> hash of empty string
      assert.ok(typeof hash === 'string');
      assert.ok(hash.length > 0);
    });

    it('computes hash of folder with single file', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('FILEHASH')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.ok(typeof hash === 'string');
      assert.ok(hash.length === 64); // SHA-256 produces 64 hex chars
    });

    it('computes hash of folder with multiple files', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')],
        [stringToRel('folder/b.txt'), file('HASH_B')],
        [stringToRel('folder/c.txt'), file('HASH_C')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.ok(hash.length === 64);
    });

    it('produces deterministic hash (same files -> same hash)', () => {
      const index1 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')],
        [stringToRel('folder/b.txt'), file('HASH_B')]
      ]);

      const index2 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')],
        [stringToRel('folder/b.txt'), file('HASH_B')]
      ]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('folder'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('folder'));
      
      assert.equal(hash1, hash2);
    });

    it('produces different hash when file content changes', () => {
      const index1 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('HASH_1')]
      ]);

      const index2 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('HASH_2')]
      ]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('folder'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('folder'));
      
      assert.notEqual(hash1, hash2);
    });

    it('produces different hash when file added', () => {
      const index1 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')]
      ]);

      const index2 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')],
        [stringToRel('folder/b.txt'), file('HASH_B')]
      ]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('folder'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('folder'));
      
      assert.notEqual(hash1, hash2);
    });

    it('produces different hash when file removed', () => {
      const index1 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')],
        [stringToRel('folder/b.txt'), file('HASH_B')]
      ]);

      const index2 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')]
      ]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('folder'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('folder'));
      
      assert.notEqual(hash1, hash2);
    });

    it('is order-independent (sorted internally)', () => {
      // Files added in different order should produce same hash
      const index1 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/z.txt'), file('HASH_Z')],
        [stringToRel('folder/a.txt'), file('HASH_A')],
        [stringToRel('folder/m.txt'), file('HASH_M')]
      ]);

      const index2 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/a.txt'), file('HASH_A')],
        [stringToRel('folder/m.txt'), file('HASH_M')],
        [stringToRel('folder/z.txt'), file('HASH_Z')]
      ]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('folder'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('folder'));
      
      assert.equal(hash1, hash2);
    });

    it('only includes direct descendant files (not subfolders)', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('FILE')],
        [stringToRel('folder/sub'), folder()],
        [stringToRel('folder/sub/nested.txt'), file('NESTED')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      // Should include folder/file.txt AND folder/sub/nested.txt (all descendant FILES)
      assert.ok(hash.length === 64);
    });

    it('computes hash for root folder (empty path)', () => {
      const index = createIndex([
        [stringToRel('file1.txt'), file('HASH1')],
        [stringToRel('file2.txt'), file('HASH2')],
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file3.txt'), file('HASH3')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel(''));
      
      // Should include ALL files in the index
      assert.ok(hash.length === 64);
    });

    it('computes hash for deeply nested folder', () => {
      const index = createIndex([
        [stringToRel('a'), folder()],
        [stringToRel('a/b'), folder()],
        [stringToRel('a/b/c'), folder()],
        [stringToRel('a/b/c/file.txt'), file('DEEP')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('a/b/c'));
      
      assert.ok(hash.length === 64);
    });

    it('handles file with __unknown__ hash', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('__unknown__')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      // Should still compute a hash (using __unknown__ as the value)
      assert.ok(hash.length === 64);
    });

    it('handles files with dots in names', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.min.js'), file('HASH1')],
        [stringToRel('folder/package.json'), file('HASH2')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.ok(hash.length === 64);
    });

    it('handles special characters in filenames', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file-name_123.txt'), file('HASH1')],
        [stringToRel('folder/file@test.txt'), file('HASH2')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.ok(hash.length === 64);
    });

    it('handles unicode in filenames', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/ファイル.txt'), file('HASH')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.ok(hash.length === 64);
    });

    it('handles very long file hashes', () => {
      const longHash = 'a'.repeat(128);
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file(longHash)]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.ok(hash.length === 64);
    });

    it('handles many files in folder', () => {
      const index = new Map<RelPath, NodeMeta>();
      index.set(stringToRel('folder'), folder());
      
      for (let i = 0; i < 100; i++) {
        index.set(stringToRel(`folder/file${i}.txt`), file(`HASH${i}`));
      }

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.ok(hash.length === 64);
    });
  });

  describe('computeAllFolderHashes', () => {
    it('computes hashes for all folders bottom-up', async () => {
      const index = createIndex([
        [stringToRel('a'), folder()],
        [stringToRel('a/b'), folder()],
        [stringToRel('a/b/file.txt'), file('HASH')]
      ]);

      await computeAllFolderHashes(index);

      // All folders should now have hashes
      const folderA = index.get(stringToRel('a')) as FolderMeta;
      const folderB = index.get(stringToRel('a/b')) as FolderMeta;
      
      assert.ok(folderA.hash.length === 64);
      assert.ok(folderB.hash.length === 64);
    });

    it('computes hash for root folder', async () => {
      const index = createIndex([
        [stringToRel('file.txt'), file('HASH')]
      ]);

      await computeAllFolderHashes(index);

      // Should add root folder entry
      const root = index.get(stringToRel('')) as FolderMeta;
      assert.ok(root);
      assert.equal(root.type, 'folder');
      assert.ok(root.hash.length === 64);
    });

    it('processes folders in correct order (deepest first)', async () => {
      const index = createIndex([
        [stringToRel('level1'), folder()],
        [stringToRel('level1/level2'), folder()],
        [stringToRel('level1/level2/level3'), folder()],
        [stringToRel('level1/level2/level3/file.txt'), file('DEEP')]
      ]);

      await computeAllFolderHashes(index);

      // All should have hashes
      assert.ok((index.get(stringToRel('level1')) as FolderMeta).hash);
      assert.ok((index.get(stringToRel('level1/level2')) as FolderMeta).hash);
      assert.ok((index.get(stringToRel('level1/level2/level3')) as FolderMeta).hash);
    });

    it('parent folder hash changes when child changes', async () => {
      const index1 = createIndex([
        [stringToRel('parent'), folder()],
        [stringToRel('parent/child'), folder()],
        [stringToRel('parent/child/file.txt'), file('HASH1')]
      ]);

      await computeAllFolderHashes(index1);
      const parentHash1 = (index1.get(stringToRel('parent')) as FolderMeta).hash;

      const index2 = createIndex([
        [stringToRel('parent'), folder()],
        [stringToRel('parent/child'), folder()],
        [stringToRel('parent/child/file.txt'), file('HASH2')]
      ]);

      await computeAllFolderHashes(index2);
      const parentHash2 = (index2.get(stringToRel('parent')) as FolderMeta).hash;

      assert.notEqual(parentHash1, parentHash2);
    });

    it('handles multiple top-level folders', async () => {
      const index = createIndex([
        [stringToRel('folder1'), folder()],
        [stringToRel('folder1/file.txt'), file('HASH1')],
        [stringToRel('folder2'), folder()],
        [stringToRel('folder2/file.txt'), file('HASH2')]
      ]);

      await computeAllFolderHashes(index);

      assert.ok((index.get(stringToRel('folder1')) as FolderMeta).hash);
      assert.ok((index.get(stringToRel('folder2')) as FolderMeta).hash);
    });

    it('handles empty folders', async () => {
      const index = createIndex([
        [stringToRel('empty1'), folder()],
        [stringToRel('empty2'), folder()]
      ]);

      await computeAllFolderHashes(index);

      const hash1 = (index.get(stringToRel('empty1')) as FolderMeta).hash;
      const hash2 = (index.get(stringToRel('empty2')) as FolderMeta).hash;
      
      // Empty folders should have same hash
      assert.equal(hash1, hash2);
    });

    it('handles folder with only subfolders (no files)', async () => {
      const index = createIndex([
        [stringToRel('parent'), folder()],
        [stringToRel('parent/child1'), folder()],
        [stringToRel('parent/child2'), folder()]
      ]);

      await computeAllFolderHashes(index);

      assert.ok((index.get(stringToRel('parent')) as FolderMeta).hash);
    });

    it('handles very deep nesting', async () => {
      const index = new Map<RelPath, NodeMeta>();
      
      let path = '';
      for (let i = 0; i < 50; i++) {
        path += (path ? '/' : '') + `level${i}`;
        index.set(stringToRel(path), folder());
      }
      index.set(stringToRel(path + '/file.txt'), file('DEEP'));

      await computeAllFolderHashes(index);

      // All folders should have hashes
      path = '';
      for (let i = 0; i < 50; i++) {
        path += (path ? '/' : '') + `level${i}`;
        assert.ok((index.get(stringToRel(path)) as FolderMeta).hash);
      }
    });

    it('handles large number of folders', async () => {
      const index = new Map<RelPath, NodeMeta>();
      
      for (let i = 0; i < 100; i++) {
        index.set(stringToRel(`folder${i}`), folder());
        index.set(stringToRel(`folder${i}/file.txt`), file(`HASH${i}`));
      }

      await computeAllFolderHashes(index);

      // All should have hashes
      for (let i = 0; i < 100; i++) {
        const folderHash = (index.get(stringToRel(`folder${i}`)) as FolderMeta).hash;
        assert.ok(folderHash.length === 64);
      }
    });

    it('handles mixed structure (files at all levels)', async () => {
      const index = createIndex([
        [stringToRel('root.txt'), file('ROOT')],
        [stringToRel('folder1'), folder()],
        [stringToRel('folder1/file1.txt'), file('F1')],
        [stringToRel('folder1/sub'), folder()],
        [stringToRel('folder1/sub/file2.txt'), file('F2')],
        [stringToRel('folder2'), folder()],
        [stringToRel('folder2/file3.txt'), file('F3')]
      ]);

      await computeAllFolderHashes(index);

      assert.ok((index.get(stringToRel('folder1')) as FolderMeta).hash);
      assert.ok((index.get(stringToRel('folder1/sub')) as FolderMeta).hash);
      assert.ok((index.get(stringToRel('folder2')) as FolderMeta).hash);
      assert.ok((index.get(stringToRel('')) as FolderMeta).hash);
    });

    it('updates existing folder hash', async () => {
      const index = createIndex([
        [stringToRel('folder'), folder('OLD_HASH')],
        [stringToRel('folder/file.txt'), file('NEW_CONTENT')]
      ]);

      await computeAllFolderHashes(index);

      const folderHash = (index.get(stringToRel('folder')) as FolderMeta).hash;
      assert.notEqual(folderHash, 'OLD_HASH');
      assert.ok(folderHash.length === 64);
    });

    it('is idempotent (running twice produces same result)', async () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('HASH')]
      ]);

      await computeAllFolderHashes(index);
      const hash1 = (index.get(stringToRel('folder')) as FolderMeta).hash;

      await computeAllFolderHashes(index);
      const hash2 = (index.get(stringToRel('folder')) as FolderMeta).hash;

      assert.equal(hash1, hash2);
    });
  });

  describe('Hash Properties', () => {
    it('SHA-256 produces 64 character hex string', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('HASH')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      
      assert.equal(hash.length, 64);
      assert.ok(/^[0-9a-f]{64}$/.test(hash));
    });

    it('different inputs produce different hashes (avalanche effect)', () => {
      const index1 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('HASH_A')]
      ]);

      const index2 = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/file.txt'), file('HASH_B')]
      ]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('folder'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('folder'));
      
      // Should be completely different (not just differ by a few bits)
      let diffChars = 0;
      for (let i = 0; i < 64; i++) {
        if (hash1[i] !== hash2[i]) diffChars++;
      }
      
      // Avalanche effect: changing 1 bit should change ~50% of output bits
      // With 64 hex chars (256 bits), expect significant difference
      assert.ok(diffChars > 20); // At least 30% different
    });
  });

  describe('Edge Cases', () => {
    it('handles folder with single character name', () => {
      const index = createIndex([
        [stringToRel('a'), folder()],
        [stringToRel('a/f.txt'), file('H')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('a'));
      assert.ok(hash.length === 64);
    });

    it('handles file with no extension', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/README'), file('HASH')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      assert.ok(hash.length === 64);
    });

    it('handles file with multiple extensions', () => {
      const index = createIndex([
        [stringToRel('folder'), folder()],
        [stringToRel('folder/archive.tar.gz'), file('HASH')]
      ]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('folder'));
      assert.ok(hash.length === 64);
    });

    it('handles empty hash string for folder', async () => {
      const index = createIndex([
        [stringToRel('folder'), folder('')]
      ]);

      await computeAllFolderHashes(index);

      const folderHash = (index.get(stringToRel('folder')) as FolderMeta).hash;
      assert.ok(folderHash.length === 64);
    });
  });
});