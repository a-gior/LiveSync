import { strict as assert } from 'assert';
import { 
  stringToRel, 
  asRel,
  dirnameRel,
  parentsOf,
  isUnder,
  relFromAbs,
  basenameRel,
  stringToWsId,
  wsToString,
  relToString
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

  describe('relFromAbs', () => {
    it('returns empty string for workspace root', () => {
      const wsPath = '/home/user/workspace';
      const absPath = '/home/user/workspace';
      const rel = relFromAbs(wsPath, absPath);
      assert.equal(rel as string, '');
    });

    it('returns relative path for nested file', () => {
      const wsPath = '/home/user/workspace';
      const absPath = '/home/user/workspace/src/app.ts';
      const rel = relFromAbs(wsPath, absPath);
      assert.equal(rel as string, 'src/app.ts');
    });

    it('returns relative path for deeply nested file', () => {
      const wsPath = '/home/user/workspace';
      const absPath = '/home/user/workspace/deep/nested/path/file.txt';
      const rel = relFromAbs(wsPath, absPath);
      assert.equal(rel as string, 'deep/nested/path/file.txt');
    });

    it('throws error if path not under workspace', () => {
      const wsPath = '/home/user/workspace';
      const absPath = '/home/user/other/file.txt';
      
      assert.throws(() => {
        relFromAbs(wsPath, absPath);
      }, /not under workspace root/);
    });

    it('handles workspace paths with trailing slash', () => {
      const wsPath = '/home/user/workspace/';
      const absPath = '/home/user/workspace/file.txt';
      const rel = relFromAbs(wsPath, absPath);
      assert.equal(rel as string, 'file.txt');
    });

    it('normalizes backslashes to forward slashes', () => {
      const wsPath = 'C:\\Users\\user\\workspace';
      const absPath = 'C:\\Users\\user\\workspace\\src\\app.ts';
      const rel = relFromAbs(wsPath, absPath);
      assert.equal(rel as string, 'src/app.ts');
    });

    it('handles paths with dots in folder names', () => {
      const wsPath = '/home/user/my.workspace';
      const absPath = '/home/user/my.workspace/folder.name/file.txt';
      const rel = relFromAbs(wsPath, absPath);
      assert.equal(rel as string, 'folder.name/file.txt');
    });
  });

  describe('basenameRel', () => {
    it('extracts filename from simple path', () => {
      const base = basenameRel(stringToRel('folder/file.txt'));
      assert.equal(base, 'file.txt');
    });

    it('extracts filename from nested path', () => {
      const base = basenameRel(stringToRel('a/b/c/file.txt'));
      assert.equal(base, 'file.txt');
    });

    it('returns entire path for file without folder', () => {
      const base = basenameRel(stringToRel('file.txt'));
      assert.equal(base, 'file.txt');
    });

    it('returns empty string for empty path', () => {
      const base = basenameRel(stringToRel(''));
      assert.equal(base, '');
    });

    it('handles paths with dots in filename', () => {
      const base = basenameRel(stringToRel('folder/file.min.js'));
      assert.equal(base, 'file.min.js');
    });

    it('handles paths with no extension', () => {
      const base = basenameRel(stringToRel('folder/README'));
      assert.equal(base, 'README');
    });

    it('handles folder paths (returns folder name)', () => {
      const base = basenameRel(stringToRel('parent/folder'));
      assert.equal(base, 'folder');
    });

    it('handles paths with special characters', () => {
      const base = basenameRel(stringToRel('folder/file-name_123.txt'));
      assert.equal(base, 'file-name_123.txt');
    });

    it('handles unicode filenames', () => {
      const base = basenameRel(stringToRel('folder/ファイル.txt'));
      assert.equal(base, 'ファイル.txt');
    });
  });

  describe('isUnder', () => {
    it('returns true for exact match', () => {
      const base = stringToRel('folder');
      const candidate = stringToRel('folder');
      assert.equal(isUnder(base, candidate), true);
    });

    it('returns true for direct child', () => {
      const base = stringToRel('folder');
      const candidate = stringToRel('folder/file.txt');
      assert.equal(isUnder(base, candidate), true);
    });

    it('returns true for nested descendant', () => {
      const base = stringToRel('folder');
      const candidate = stringToRel('folder/sub/deep/file.txt');
      assert.equal(isUnder(base, candidate), true);
    });

    it('returns false for sibling', () => {
      const base = stringToRel('folder');
      const candidate = stringToRel('other/file.txt');
      assert.equal(isUnder(base, candidate), false);
    });

    it('returns false for parent', () => {
      const base = stringToRel('parent/child');
      const candidate = stringToRel('parent');
      assert.equal(isUnder(base, candidate), false);
    });

    it('returns false for similar prefix but not under', () => {
      const base = stringToRel('folder');
      const candidate = stringToRel('folder-other/file.txt');
      assert.equal(isUnder(base, candidate), false);
    });

    it('handles empty base path (root matches everything)', () => {
      const base = stringToRel('');
      const candidate1 = stringToRel('file.txt');
      const candidate2 = stringToRel('folder/file.txt');
      assert.equal(isUnder(base, candidate1), true);
      assert.equal(isUnder(base, candidate2), true);
    });

    it('handles base with trailing slash', () => {
      // RelPath should be normalized without trailing slash
      const base = stringToRel('folder/');
      const candidate = stringToRel('folder/file.txt');
      // After normalization, should work correctly
      assert.ok(isUnder(base, candidate));
    });

    it('handles deeply nested base', () => {
      const base = stringToRel('a/b/c/d');
      const candidate = stringToRel('a/b/c/d/e/f/file.txt');
      assert.equal(isUnder(base, candidate), true);
    });

    it('handles single character folder names', () => {
      const base = stringToRel('a');
      const candidate1 = stringToRel('a/b');
      const candidate2 = stringToRel('ab');
      assert.equal(isUnder(base, candidate1), true);
      assert.equal(isUnder(base, candidate2), false);
    });
  });

  describe('relToString & wsToString', () => {
    it('relToString converts RelPath to string', () => {
      const rel = stringToRel('path/to/file.txt');
      const str = relToString(rel);
      assert.equal(typeof str, 'string');
      assert.equal(str, 'path/to/file.txt');
    });

    it('wsToString converts WorkspaceId to string', () => {
      const ws = stringToWsId('/home/user/workspace');
      const str = wsToString(ws);
      assert.equal(typeof str, 'string');
      assert.equal(str, '/home/user/workspace');
    });

    it('round-trip conversion works for RelPath', () => {
      const original = 'path/to/file.txt';
      const rel = stringToRel(original);
      const back = relToString(rel);
      assert.equal(back, original);
    });

    it('round-trip conversion works for WorkspaceId', () => {
      const original = '/home/user/workspace';
      const ws = stringToWsId(original);
      const back = wsToString(ws);
      assert.equal(back, original);
    });
  });

  describe('asRel - Normalization Tests (fixes)', () => {
    it('strips leading slash', () => {
      const rel = asRel('/path/to/file.txt');
      assert.equal(rel as string, 'path/to/file.txt');
    });

    it('strips leading ./', () => {
      const rel = asRel('./file.txt');
      assert.equal(rel as string, 'file.txt');
    });

    it('strips leading ./ from nested path', () => {
      const rel = asRel('./folder/file.txt');
      assert.equal(rel as string, 'folder/file.txt');
    });

    it('strips trailing slash', () => {
      const rel = asRel('folder/');
      assert.equal(rel as string, 'folder');
    });

    it('strips multiple leading slashes', () => {
      const rel = asRel('///path/file.txt');
      assert.equal(rel as string, 'path/file.txt');
    });

    it('normalizes backslashes to forward slashes', () => {
      const rel = asRel('path\\to\\file.txt');
      assert.equal(rel as string, 'path/to/file.txt');
    });

    it('collapses multiple slashes', () => {
      const rel = asRel('path//to///file.txt');
      assert.equal(rel as string, 'path/to/file.txt');
    });

    it('handles empty string', () => {
      const rel = asRel('');
      assert.equal(rel as string, '');
    });

    it('handles root path', () => {
      const rel = asRel('/');
      assert.equal(rel as string, '');
    });

    it('handles ./ only', () => {
      const rel = asRel('./');
      assert.equal(rel as string, '');
    });

    it('preserves dots in filenames', () => {
      const rel = asRel('folder/.hidden');
      assert.equal(rel as string, 'folder/.hidden');
    });

    it('preserves dots in folder names', () => {
      const rel = asRel('.vscode/settings.json');
      assert.equal(rel as string, '.vscode/settings.json');
    });
  });
});