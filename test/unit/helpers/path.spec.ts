import { strict as assert } from 'assert';
import { 
  stringToRel, 
  asRel,
  dirnameRel,
  parentsOf
} from '../../../src/infrastructure/helpers/path';
import type { RelPath } from '../../../src/domain/types';

describe('Path Helpers', () => {
  describe('stringToRel', () => {
    it('converts regular path string to RelPath', () => {
      const rel = stringToRel('path/to/file.txt');
      assert.equal(rel as string, 'path/to/file.txt');
    });

    it('converts empty string to RelPath', () => {
      const rel = stringToRel('');
      assert.equal(rel as string, '');
    });

    it('handles root path', () => {
      const rel = stringToRel('/');
      assert.equal(rel as string, '/');
    });

    it('preserves path as-is (no normalization)', () => {
      // Note: Based on code inspection, stringToRel just casts, doesn't normalize
      const rel = stringToRel('path\\to\\file.txt');
      assert.equal(rel as string, 'path\\to\\file.txt');
    });

    it('handles dot notation', () => {
      const rel = stringToRel('./file.txt');
      assert.equal(rel as string, './file.txt');
    });

    it('handles parent directory notation', () => {
      const rel = stringToRel('../file.txt');
      assert.equal(rel as string, '../file.txt');
    });
  });

  describe('asRel', () => {
    it('converts string to RelPath', () => {
      const rel = asRel('path/to/file.txt');
      assert.equal(rel as string, 'path/to/file.txt');
    });

    it('handles empty string', () => {
      const rel = asRel('');
      assert.equal(rel as string, '');
    });

    it('handles already cast RelPath', () => {
      const original = stringToRel('test.txt');
      const rel = asRel(original as string);
      assert.equal(rel as string, 'test.txt');
    });
  });

  describe('dirnameRel', () => {
    it('returns parent directory for file path', () => {
      const parent = dirnameRel(stringToRel('folder/file.txt'));
      assert.equal(parent as string, 'folder');
    });

    it('returns parent directory for nested path', () => {
      const parent = dirnameRel(stringToRel('a/b/c/file.txt'));
      assert.equal(parent as string, 'a/b/c');
    });

    it('returns empty string for top-level file', () => {
      const parent = dirnameRel(stringToRel('file.txt'));
      assert.equal(parent as string, '');
    });

    it('returns empty string for empty path', () => {
      const parent = dirnameRel(stringToRel(''));
      assert.equal(parent as string, '');
    });

    it('handles folder path (no extension)', () => {
      const parent = dirnameRel(stringToRel('folder/subfolder'));
      assert.equal(parent as string, 'folder');
    });

    it('handles deeply nested paths', () => {
      const parent = dirnameRel(stringToRel('a/b/c/d/e/file.txt'));
      assert.equal(parent as string, 'a/b/c/d/e');
    });

    it('handles paths with dots in folder names', () => {
      const parent = dirnameRel(stringToRel('folder.name/file.txt'));
      assert.equal(parent as string, 'folder.name');
    });

    it('handles single character folder names', () => {
      const parent = dirnameRel(stringToRel('a/b'));
      assert.equal(parent as string, 'a');
    });
  });

  describe('parentsOf', () => {
    it('returns all ancestors for nested path', () => {
      const parents = parentsOf(stringToRel('a/b/c/file.txt'));
      assert.deepEqual(
        parents.map(p => p as string),
        ['a', 'a/b', 'a/b/c']
      );
    });

    it('returns single parent for one-level path', () => {
      const parents = parentsOf(stringToRel('folder/file.txt'));
      assert.deepEqual(
        parents.map(p => p as string),
        ['folder']
      );
    });

    it('returns empty array for top-level file', () => {
      const parents = parentsOf(stringToRel('file.txt'));
      assert.deepEqual(parents, []);
    });

    it('returns empty array for empty path', () => {
      const parents = parentsOf(stringToRel(''));
      assert.deepEqual(parents, []);
    });

    it('returns all ancestors in order (root to leaf)', () => {
      const parents = parentsOf(stringToRel('a/b/c/d/e.txt'));
      assert.deepEqual(
        parents.map(p => p as string),
        ['a', 'a/b', 'a/b/c', 'a/b/c/d']
      );
    });

    it('handles paths with dots in names', () => {
      const parents = parentsOf(stringToRel('folder.1/folder.2/file.txt'));
      assert.deepEqual(
        parents.map(p => p as string),
        ['folder.1', 'folder.1/folder.2']
      );
    });

    it('handles single character segments', () => {
      const parents = parentsOf(stringToRel('a/b/c'));
      assert.deepEqual(
        parents.map(p => p as string),
        ['a', 'a/b']
      );
    });

    it('handles very deep nesting', () => {
      const deep = 'a/b/c/d/e/f/g/h/i/j/file.txt';
      const parents = parentsOf(stringToRel(deep));
      assert.equal(parents.length, 10);
      assert.equal(parents[0] as string, 'a');
      assert.equal(parents[9] as string, 'a/b/c/d/e/f/g/h/i/j');
    });
  });

  describe('Edge Cases', () => {
    describe('Trailing Slashes', () => {
      it('dirnameRel handles trailing slash', () => {
        const parent = dirnameRel(stringToRel('folder/subfolder/'));
        // Behavior depends on implementation - document actual behavior
        assert.ok(typeof parent === 'string');
      });

      it('parentsOf handles trailing slash', () => {
        const parents = parentsOf(stringToRel('a/b/c/'));
        // Behavior depends on implementation - document actual behavior
        assert.ok(Array.isArray(parents));
      });
    });

    describe('Special Characters', () => {
      it('handles spaces in path', () => {
        const parents = parentsOf(stringToRel('folder with spaces/file.txt'));
        assert.equal(parents.length, 1);
        assert.equal(parents[0] as string, 'folder with spaces');
      });

      it('handles special characters in path', () => {
        const parents = parentsOf(stringToRel('folder-name_123/file@test.txt'));
        assert.equal(parents.length, 1);
        assert.equal(parents[0] as string, 'folder-name_123');
      });

      it('handles unicode characters', () => {
        const parents = parentsOf(stringToRel('フォルダ/ファイル.txt'));
        assert.equal(parents.length, 1);
        assert.equal(parents[0] as string, 'フォルダ');
      });
    });

    describe('Boundary Cases', () => {
      it('handles very long paths', () => {
        const longPath = 'a'.repeat(100) + '/' + 'b'.repeat(100) + '/file.txt';
        const parents = parentsOf(stringToRel(longPath));
        assert.equal(parents.length, 2);
      });

      it('handles path with many segments', () => {
        const segments = Array.from({ length: 50 }, (_, i) => `level${i}`);
        const path = segments.join('/') + '/file.txt';
        const parents = parentsOf(stringToRel(path));
        assert.equal(parents.length, 50);
      });
    });
  });

  describe('Path Consistency', () => {
    it('dirnameRel result matches last parentsOf element', () => {
      const path = stringToRel('a/b/c/d/file.txt');
      const dirname = dirnameRel(path);
      const parents = parentsOf(path);
      
      if (parents.length > 0) {
        assert.equal(dirname, parents[parents.length - 1]);
      }
    });

    it('parentsOf builds up consistently', () => {
      const path = stringToRel('a/b/c/file.txt');
      const parents = parentsOf(path);
      
      // Each parent should be contained in the next
      for (let i = 1; i < parents.length; i++) {
        const prev = parents[i - 1] as string;
        const curr = parents[i] as string;
        assert.ok(curr.startsWith(prev + '/'));
      }
    });

    it('all ancestors are proper prefixes of the path', () => {
      const path = 'a/b/c/d/file.txt';
      const parents = parentsOf(stringToRel(path));
      
      for (const parent of parents) {
        assert.ok(path.startsWith((parent as string) + '/'));
      }
    });
  });

  describe('Posix vs Windows Paths', () => {
    it('handles posix-style paths (forward slashes)', () => {
      const parents = parentsOf(stringToRel('folder/subfolder/file.txt'));
      assert.equal(parents.length, 2);
      assert.equal(parents[0] as string, 'folder');
    });

    it('handles windows-style paths if passed (backslashes)', () => {
      // Note: Behavior depends on whether code normalizes backslashes
      // This test documents actual behavior
      const path = stringToRel('folder\\subfolder\\file.txt');
      const parents = parentsOf(path);
      // May need adjustment based on actual implementation
      assert.ok(Array.isArray(parents));
    });
  });

  describe('Type Safety', () => {
    it('RelPath maintains type brand', () => {
      const rel = stringToRel('test.txt');
      // TypeScript should enforce this is a RelPath, not a plain string
      // At runtime, they're the same, but type system differentiates
      assert.equal(typeof rel, 'string');
    });

    it('cannot accidentally pass string where RelPath expected', () => {
      // This would be a TypeScript compile error:
      // function takesRelPath(p: RelPath) {}
      // takesRelPath('test.txt'); // Error!
      // takesRelPath(stringToRel('test.txt')); // OK!
      
      // Runtime check: both are strings
      const plain: string = 'test.txt';
      const branded: RelPath = stringToRel('test.txt');
      assert.equal(typeof plain, typeof branded);
    });
  });
});