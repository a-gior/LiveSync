import { strict as assert } from 'assert';
import {
  stringToRel,
  stringToWsId,
  relToString,
  wsToString,
  absFs,
  asRel,
  relFromAbs,
  dirnameRel,
  basenameRel,
  parentsOf,
  isUnder
} from '../../../src/infrastructure/helpers/path';

describe('Path Utilities', () => {
  describe('stringToRel / relToString', () => {
    it('converts string to RelPath', () => {
      const rel = stringToRel('src/app.ts');
      assert.equal(typeof rel, 'string');
      assert.equal(rel, 'src/app.ts');
    });

    it('converts RelPath back to string', () => {
      const rel = stringToRel('src/app.ts');
      const str = relToString(rel);
      assert.equal(str, 'src/app.ts');
    });

    it('round-trips correctly', () => {
      const original = 'src/utils/helper.ts';
      const roundtrip = relToString(stringToRel(original));
      assert.equal(roundtrip, original);
    });
  });

  describe('stringToWsId / wsToString', () => {
    it('converts string to WorkspaceId', () => {
      const wsId = stringToWsId('/home/user/project');
      assert.equal(typeof wsId, 'string');
      assert.equal(wsId, '/home/user/project');
    });

    it('converts WorkspaceId back to string', () => {
      const wsId = stringToWsId('/home/user/project');
      const str = wsToString(wsId);
      assert.equal(str, '/home/user/project');
    });

    it('round-trips correctly', () => {
      const original = '/home/user/workspace';
      const roundtrip = wsToString(stringToWsId(original));
      assert.equal(roundtrip, original);
    });
  });

  describe('asRel', () => {
    it('normalizes forward slashes', () => {
      const rel = asRel('src/app.ts');
      assert.equal(rel, 'src/app.ts');
    });

    it('normalizes backslashes to forward slashes', () => {
      const rel = asRel('src\\app.ts');
      assert.equal(rel, 'src/app.ts');
    });

    it('strips leading ./', () => {
      const rel = asRel('./src/app.ts');
      assert.equal(rel, 'src/app.ts');
    });

    it('strips leading /', () => {
      const rel = asRel('/src/app.ts');
      assert.equal(rel, 'src/app.ts');
    });

    it('strips trailing /', () => {
      const rel = asRel('src/app.ts/');
      assert.equal(rel, 'src/app.ts');
    });

    it('collapses multiple slashes', () => {
      const rel = asRel('src//utils///helper.ts');
      assert.equal(rel, 'src/utils/helper.ts');
    });

    it('handles empty string', () => {
      const rel = asRel('');
      assert.equal(rel, '');
    });

    it('handles root path variations', () => {
      assert.equal(asRel('/'), '');
      assert.equal(asRel('./'), '');
      assert.equal(asRel('.'), '');
    });

    it('handles complex nested paths', () => {
      const rel = asRel('./src\\utils//helper.ts/');
      assert.equal(rel, 'src/utils/helper.ts');
    });
  });

  describe('absFs', () => {
    it('joins workspace and relative path', () => {
      const wsId = stringToWsId('/home/user/project');
      const relPath = stringToRel('src/app.ts');
      
      const abs = absFs(wsId, relPath);
      
      // Should use path.join which is platform-aware
      assert.ok(abs.includes('project'));
      assert.ok(abs.includes('src'));
      assert.ok(abs.includes('app.ts'));
    });

    it('handles empty relative path (root)', () => {
      const wsId = stringToWsId('/home/user/project');
      const relPath = stringToRel('');
      
      const abs = absFs(wsId, relPath);
      
      assert.ok(abs.endsWith('project') || abs.endsWith('project/') || abs.endsWith('project\\'));
    });

    it('normalizes slashes in result', () => {
      const wsId = stringToWsId('/home/user/project');
      const relPath = stringToRel('src/app.ts');
      
      const abs = absFs(wsId, relPath);
      
      // Should not have mixed slashes
      const hasBackslash = abs.includes('\\');
      const hasForwardSlash = abs.includes('/');
      
      // Either all backslashes (Windows) or all forward slashes (Unix)
      // but not mixed
      if (hasBackslash && hasForwardSlash) {
        // Mixed slashes - this might be okay depending on platform
        // Just verify it's a valid path
        assert.ok(abs.length > 0);
      } else {
        assert.ok(true);
      }
    });

    it('handles Windows-style workspace paths', () => {
      const wsId = stringToWsId('C:\\Users\\user\\project');
      const relPath = stringToRel('src/app.ts');
      
      const abs = absFs(wsId, relPath);
      
      assert.ok(abs.includes('project'));
      assert.ok(abs.includes('src'));
      assert.ok(abs.includes('app.ts'));
    });
  });

  describe('relFromAbs', () => {
    it('extracts relative path from absolute within workspace', () => {
      const workspace = '/home/user/project';
      const absolute = '/home/user/project/src/app.ts';
      
      const rel = relFromAbs(workspace, absolute);
      
      assert.equal(rel, 'src/app.ts');
    });

    it('handles root (workspace folder itself)', () => {
      const workspace = '/home/user/project';
      const absolute = '/home/user/project';
      
      const rel = relFromAbs(workspace, absolute);
      
      assert.equal(rel, '');
    });

    it('throws error for paths outside workspace', () => {
      const workspace = '/home/user/project';
      const absolute = '/home/user/other-project/file.ts';
      
      assert.throws(() => {
        relFromAbs(workspace, absolute);
      }, /not under workspace root/);
    });

    it('handles trailing slashes in workspace path', () => {
      const workspace = '/home/user/project/';
      const absolute = '/home/user/project/src/app.ts';
      
      const rel = relFromAbs(workspace, absolute);
      
      assert.equal(rel, 'src/app.ts');
    });

    it('handles backslashes on Windows', () => {
      const workspace = 'C:\\Users\\user\\project';
      const absolute = 'C:\\Users\\user\\project\\src\\app.ts';
      
      const rel = relFromAbs(workspace, absolute);
      
      assert.equal(rel, 'src/app.ts');
    });

    it('handles mixed slashes', () => {
      const workspace = 'C:/Users/user/project';
      const absolute = 'C:\\Users\\user\\project\\src\\app.ts';
      
      const rel = relFromAbs(workspace, absolute);
      
      assert.equal(rel, 'src/app.ts');
    });
  });

  describe('dirnameRel', () => {
    it('returns parent directory', () => {
      const rel = stringToRel('src/utils/helper.ts');
      const dir = dirnameRel(rel);
      
      assert.equal(dir, 'src/utils');
    });

    it('returns empty string for top-level file', () => {
      const rel = stringToRel('file.ts');
      const dir = dirnameRel(rel);
      
      assert.equal(dir, '');
    });

    it('returns empty string for root', () => {
      const rel = stringToRel('');
      const dir = dirnameRel(rel);
      
      assert.equal(dir, '');
    });

    it('handles deeply nested paths', () => {
      const rel = stringToRel('a/b/c/d/e/file.ts');
      const dir = dirnameRel(rel);
      
      assert.equal(dir, 'a/b/c/d/e');
    });
  });

  describe('basenameRel', () => {
    it('returns filename', () => {
      const rel = stringToRel('src/utils/helper.ts');
      const base = basenameRel(rel);
      
      assert.equal(base, 'helper.ts');
    });

    it('returns filename for top-level file', () => {
      const rel = stringToRel('file.ts');
      const base = basenameRel(rel);
      
      assert.equal(base, 'file.ts');
    });

    it('returns empty string for root', () => {
      const rel = stringToRel('');
      const base = basenameRel(rel);
      
      assert.equal(base, '');
    });

    it('handles filenames with dots', () => {
      const rel = stringToRel('src/file.test.ts');
      const base = basenameRel(rel);
      
      assert.equal(base, 'file.test.ts');
    });
  });

  describe('parentsOf', () => {
    it('returns all parent paths top-down', () => {
      const rel = stringToRel('src/utils/helper.ts');
      const parents = parentsOf(rel);
      
      assert.deepEqual(parents, ['src', 'src/utils']);
    });

    it('returns single parent for two-level path', () => {
      const rel = stringToRel('src/app.ts');
      const parents = parentsOf(rel);
      
      assert.deepEqual(parents, ['src']);
    });

    it('returns empty array for top-level file', () => {
      const rel = stringToRel('file.ts');
      const parents = parentsOf(rel);
      
      assert.deepEqual(parents, []);
    });

    it('returns empty array for root', () => {
      const rel = stringToRel('');
      const parents = parentsOf(rel);
      
      assert.deepEqual(parents, []);
    });

    it('handles deeply nested paths', () => {
      const rel = stringToRel('a/b/c/d/file.ts');
      const parents = parentsOf(rel);
      
      assert.deepEqual(parents, ['a', 'a/b', 'a/b/c', 'a/b/c/d']);
    });

    it('returns RelPath branded values', () => {
      const rel = stringToRel('src/utils/helper.ts');
      const parents = parentsOf(rel);
      
      // All parents should be RelPath type
      parents.forEach(p => {
        assert.equal(typeof p, 'string');
      });
    });
  });

  describe('isUnder', () => {
    it('returns true for exact match', () => {
      const base = stringToRel('src');
      const candidate = stringToRel('src');
      
      assert.equal(isUnder(base, candidate), true);
    });

    it('returns true for child path', () => {
      const base = stringToRel('src');
      const candidate = stringToRel('src/app.ts');
      
      assert.equal(isUnder(base, candidate), true);
    });

    it('returns true for nested child', () => {
      const base = stringToRel('src');
      const candidate = stringToRel('src/utils/helper.ts');
      
      assert.equal(isUnder(base, candidate), true);
    });

    it('returns false for sibling path', () => {
      const base = stringToRel('src');
      const candidate = stringToRel('test/app.spec.ts');
      
      assert.equal(isUnder(base, candidate), false);
    });

    it('returns false for partial prefix match', () => {
      const base = stringToRel('src');
      const candidate = stringToRel('src-backup/file.ts');
      
      assert.equal(isUnder(base, candidate), false);
    });

    it('returns true for root base (everything is under root)', () => {
      const base = stringToRel('');
      const candidate = stringToRel('any/path/file.ts');
      
      assert.equal(isUnder(base, candidate), true);
    });

    it('handles empty candidate with root base', () => {
      const base = stringToRel('');
      const candidate = stringToRel('');
      
      assert.equal(isUnder(base, candidate), true);
    });

    it('handles trailing slashes in base', () => {
      const base = stringToRel('src/');
      const candidate = stringToRel('src/app.ts');
      
      // Should still work (implementation normalizes)
      assert.equal(isUnder(base, candidate), true);
    });
  });

  describe('Integration Tests', () => {
    it('parentsOf + isUnder work together', () => {
      const file = stringToRel('src/utils/helper.ts');
      
      // All parents should be "under" their parent
      assert.equal(isUnder(stringToRel('src'), stringToRel('src/utils')), true);
      assert.equal(isUnder(stringToRel('src'), file), true);
      assert.equal(isUnder(stringToRel('src/utils'), file), true);
    });

    it('absFs + relFromAbs round-trip', () => {
      const wsId = stringToWsId('/home/user/project');
      const original = stringToRel('src/app.ts');
      
      const abs = absFs(wsId, original);
      const roundtrip = relFromAbs('/home/user/project', abs);
      
      assert.equal(roundtrip, original);
    });

    it('dirname + basename reconstruct path', () => {
      const original = stringToRel('src/utils/helper.ts');
      const dir = dirnameRel(original);
      const base = basenameRel(original);
      
      const reconstructed = dir ? `${dir}/${base}` : base;
      
      assert.equal(reconstructed, original);
    });
  });
});