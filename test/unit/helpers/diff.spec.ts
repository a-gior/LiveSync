import { strict as assert } from 'assert';
import {
  isUploadable,
  isDeletable,
  isDownloadable,
  isResolvable,
  collectUnder,
  partitionChangesUnder,
  topMost
} from '../../../src/infrastructure/helpers/diff';
import { stringToRel } from '../../../src/infrastructure/helpers/path';
import type { DiffMap, DiffEntry, DiffStatus, RelPath } from '../../../src/domain/types';

// Helper to create diff entries
const diffEntry = (
  path: string,
  status: DiffStatus,
  type: 'file' | 'folder'
): DiffEntry => ({
  path: stringToRel(path),
  status,
  type,
  left: undefined,
  right: undefined,
});

describe('Diff Utilities', () => {
  describe('isUploadable', () => {
    it('returns true for added status', () => {
      assert.equal(isUploadable('added'), true);
    });

    it('returns true for modified status', () => {
      assert.equal(isUploadable('modified'), true);
    });

    it('returns true for unchanged status', () => {
      assert.equal(isUploadable('unchanged'), true);
    });

    it('returns true for conflict status', () => {
      assert.equal(isUploadable('conflict'), true);
    });

    it('returns false for removed status', () => {
      assert.equal(isUploadable('removed'), false);
    });
  });

  describe('isDeletable', () => {
    it('returns true for removed status', () => {
      assert.equal(isDeletable('removed'), true);
    });

    it('returns false for added status', () => {
      assert.equal(isDeletable('added'), false);
    });

    it('returns false for modified status', () => {
      assert.equal(isDeletable('modified'), false);
    });

    it('returns false for unchanged status', () => {
      assert.equal(isDeletable('unchanged'), false);
    });

    it('returns false for conflict status', () => {
      assert.equal(isDeletable('conflict'), false);
    });
  });

  describe('isDownloadable', () => {
    it('returns true for removed status', () => {
      assert.equal(isDownloadable('removed'), true);
    });

    it('returns true for modified status', () => {
      assert.equal(isDownloadable('modified'), true);
    });

    it('returns true for unchanged status', () => {
      assert.equal(isDownloadable('unchanged'), true);
    });

    it('returns true for conflict status', () => {
      assert.equal(isDownloadable('conflict'), true);
    });

    it('returns false for added status', () => {
      assert.equal(isDownloadable('added'), false);
    });
  });

  describe('isResolvable', () => {
    it('returns true for modified status', () => {
      assert.equal(isResolvable('modified'), true);
    });

    it('returns true for conflict status', () => {
      assert.equal(isResolvable('conflict'), true);
    });

    it('returns false for added status', () => {
      assert.equal(isResolvable('added'), false);
    });

    it('returns false for removed status', () => {
      assert.equal(isResolvable('removed'), false);
    });

    it('returns false for unchanged status', () => {
      assert.equal(isResolvable('unchanged'), false);
    });
  });

  describe('collectUnder', () => {
    it('collects all paths under root', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/app.ts'), diffEntry('src/app.ts', 'added', 'file')],
        [stringToRel('src/utils/helper.ts'), diffEntry('src/utils/helper.ts', 'modified', 'file')],
        [stringToRel('test/app.spec.ts'), diffEntry('test/app.spec.ts', 'added', 'file')],
      ]);

      const srcPaths = collectUnder(diff, stringToRel('src'));

      assert.equal(srcPaths.length, 2);
      assert.ok(srcPaths.some(p => p === 'src/app.ts'));
      assert.ok(srcPaths.some(p => p === 'src/utils/helper.ts'));
      assert.ok(!srcPaths.some(p => p === 'test/app.spec.ts'));
    });

    it('includes root itself if present', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src'), diffEntry('src', 'modified', 'folder')],
        [stringToRel('src/app.ts'), diffEntry('src/app.ts', 'added', 'file')],
      ]);

      const srcPaths = collectUnder(diff, stringToRel('src'));

      assert.equal(srcPaths.length, 2);
      assert.ok(srcPaths.includes(stringToRel('src')));
      assert.ok(srcPaths.includes(stringToRel('src/app.ts')));
    });

    it('returns empty array for non-matching root', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/app.ts'), diffEntry('src/app.ts', 'added', 'file')],
      ]);

      const testPaths = collectUnder(diff, stringToRel('test'));

      assert.deepEqual(testPaths, []);
    });

    it('collects everything for root path', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/app.ts'), diffEntry('src/app.ts', 'added', 'file')],
        [stringToRel('test/app.spec.ts'), diffEntry('test/app.spec.ts', 'modified', 'file')],
        [stringToRel('README.md'), diffEntry('README.md', 'unchanged', 'file')],
      ]);

      const allPaths = collectUnder(diff, stringToRel(''));

      assert.equal(allPaths.length, 3);
    });

    it('handles deeply nested paths', () => {
      const diff: DiffMap = new Map([
        [stringToRel('a/b/c/d/file.ts'), diffEntry('a/b/c/d/file.ts', 'added', 'file')],
      ]);

      const paths = collectUnder(diff, stringToRel('a/b'));

      assert.equal(paths.length, 1);
      assert.ok(paths.includes(stringToRel('a/b/c/d/file.ts')));
    });

    it('does not match partial prefixes', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/app.ts'), diffEntry('src/app.ts', 'added', 'file')],
        [stringToRel('src-backup/app.ts'), diffEntry('src-backup/app.ts', 'added', 'file')],
      ]);

      const srcPaths = collectUnder(diff, stringToRel('src'));

      assert.equal(srcPaths.length, 1);
      assert.ok(srcPaths.includes(stringToRel('src/app.ts')));
      assert.ok(!srcPaths.includes(stringToRel('src-backup/app.ts')));
    });
  });

  describe('partitionChangesUnder', () => {
    it('partitions uploadable and deletable files', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/added.ts'), diffEntry('src/added.ts', 'added', 'file')],
        [stringToRel('src/modified.ts'), diffEntry('src/modified.ts', 'modified', 'file')],
        [stringToRel('src/removed.ts'), diffEntry('src/removed.ts', 'removed', 'file')],
        [stringToRel('src/unchanged.ts'), diffEntry('src/unchanged.ts', 'unchanged', 'file')],
      ]);

      const { toUploadFiles, toDeleteFiles, removedDirs } = partitionChangesUnder(
        diff,
        stringToRel('src')
      );

      assert.equal(toUploadFiles.length, 3); // added, modified, unchanged
      assert.equal(toDeleteFiles.length, 1); // removed
      assert.equal(removedDirs.length, 0);
    });

    it('identifies removed directories', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/old-folder'), diffEntry('src/old-folder', 'removed', 'folder')],
        [stringToRel('src/file.ts'), diffEntry('src/file.ts', 'added', 'file')],
      ]);

      const { toUploadFiles, toDeleteFiles, removedDirs } = partitionChangesUnder(
        diff,
        stringToRel('src')
      );

      assert.equal(toUploadFiles.length, 1);
      assert.equal(toDeleteFiles.length, 0);
      assert.equal(removedDirs.length, 1);
      assert.ok(removedDirs.includes(stringToRel('src/old-folder')));
    });

    it('ignores entries outside root', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/file.ts'), diffEntry('src/file.ts', 'added', 'file')],
        [stringToRel('test/file.spec.ts'), diffEntry('test/file.spec.ts', 'added', 'file')],
      ]);

      const { toUploadFiles } = partitionChangesUnder(
        diff,
        stringToRel('src')
      );

      assert.equal(toUploadFiles.length, 1);
      assert.ok(toUploadFiles.includes(stringToRel('src/file.ts')));
    });

    it('handles conflicts as uploadable', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/conflict.ts'), diffEntry('src/conflict.ts', 'conflict', 'file')],
      ]);

      const { toUploadFiles } = partitionChangesUnder(diff, stringToRel('src'));

      assert.equal(toUploadFiles.length, 1);
      assert.ok(toUploadFiles.includes(stringToRel('src/conflict.ts')));
    });

    it('ignores folder entries except removed', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/folder1'), diffEntry('src/folder1', 'added', 'folder')],
        [stringToRel('src/folder2'), diffEntry('src/folder2', 'modified', 'folder')],
        [stringToRel('src/folder3'), diffEntry('src/folder3', 'removed', 'folder')],
      ]);

      const { toUploadFiles, toDeleteFiles, removedDirs } = partitionChangesUnder(
        diff,
        stringToRel('src')
      );

      assert.equal(toUploadFiles.length, 0);
      assert.equal(toDeleteFiles.length, 0);
      assert.equal(removedDirs.length, 1);
      assert.ok(removedDirs.includes(stringToRel('src/folder3')));
    });

    it('handles empty diff', () => {
      const diff: DiffMap = new Map();

      const { toUploadFiles, toDeleteFiles, removedDirs } = partitionChangesUnder(
        diff,
        stringToRel('src')
      );

      assert.deepEqual(toUploadFiles, []);
      assert.deepEqual(toDeleteFiles, []);
      assert.deepEqual(removedDirs, []);
    });

    it('works with root path', () => {
      const diff: DiffMap = new Map([
        [stringToRel('file.ts'), diffEntry('file.ts', 'added', 'file')],
        [stringToRel('removed.ts'), diffEntry('removed.ts', 'removed', 'file')],
      ]);

      const { toUploadFiles, toDeleteFiles } = partitionChangesUnder(
        diff,
        stringToRel('')
      );

      assert.equal(toUploadFiles.length, 1);
      assert.equal(toDeleteFiles.length, 1);
    });
  });

  describe('topMost', () => {
    it('keeps only top-level directories', () => {
      const dirs = [
        stringToRel('a'),
        stringToRel('a/b'),
        stringToRel('a/b/c'),
      ];

      const result = topMost(dirs);

      assert.equal(result.length, 1);
      assert.ok(result.includes(stringToRel('a')));
    });

    it('keeps multiple independent top-level dirs', () => {
      const dirs = [
        stringToRel('src'),
        stringToRel('src/utils'),
        stringToRel('test'),
        stringToRel('test/unit'),
      ];

      const result = topMost(dirs);

      assert.equal(result.length, 2);
      assert.ok(result.includes(stringToRel('src')));
      assert.ok(result.includes(stringToRel('test')));
    });

    it('handles single directory', () => {
      const dirs = [stringToRel('src')];

      const result = topMost(dirs);

      assert.equal(result.length, 1);
      assert.ok(result.includes(stringToRel('src')));
    });

    it('handles empty array', () => {
      const dirs: RelPath[] = [];

      const result = topMost(dirs);

      assert.deepEqual(result, []);
    });

    it('removes nested siblings', () => {
      const dirs = [
        stringToRel('src'),
        stringToRel('src/a'),
        stringToRel('src/b'),
        stringToRel('src/a/deep'),
      ];

      const result = topMost(dirs);

      assert.equal(result.length, 1);
      assert.ok(result.includes(stringToRel('src')));
    });

    it('handles similar prefixes correctly', () => {
      const dirs = [
        stringToRel('src'),
        stringToRel('src-backup'),
        stringToRel('src/utils'),
      ];

      const result = topMost(dirs);

      assert.equal(result.length, 2);
      assert.ok(result.includes(stringToRel('src')));
      assert.ok(result.includes(stringToRel('src-backup')));
    });

    it('keeps order stable', () => {
      const dirs = [
        stringToRel('b'),
        stringToRel('a'),
        stringToRel('c'),
      ];

      const result = topMost(dirs);

      assert.equal(result.length, 3);
      // All should be kept since none are nested
    });

    it('handles deeply nested structure', () => {
      const dirs = [
        stringToRel('a'),
        stringToRel('a/b'),
        stringToRel('a/b/c'),
        stringToRel('a/b/c/d'),
        stringToRel('a/b/c/d/e'),
      ];

      const result = topMost(dirs);

      assert.equal(result.length, 1);
      assert.ok(result.includes(stringToRel('a')));
    });

    it('preserves order when multiple tops exist', () => {
      const dirs = [
        stringToRel('src'),
        stringToRel('src/utils'),
        stringToRel('test'),
        stringToRel('docs'),
      ];

      const result = topMost(dirs);

      assert.equal(result.length, 3);
      assert.ok(result.includes(stringToRel('src')));
      assert.ok(result.includes(stringToRel('test')));
      assert.ok(result.includes(stringToRel('docs')));
    });
  });

  describe('Integration Tests', () => {
    it('collectUnder + partitionChangesUnder work together', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/added.ts'), diffEntry('src/added.ts', 'added', 'file')],
        [stringToRel('src/removed.ts'), diffEntry('src/removed.ts', 'removed', 'file')],
        [stringToRel('test/test.ts'), diffEntry('test/test.ts', 'added', 'file')],
      ]);

      const srcPaths = collectUnder(diff, stringToRel('src'));
      assert.equal(srcPaths.length, 2);

      const { toUploadFiles, toDeleteFiles } = partitionChangesUnder(
        diff,
        stringToRel('src')
      );
      
      assert.equal(toUploadFiles.length, 1);
      assert.equal(toDeleteFiles.length, 1);
    });

    it('partitionChangesUnder + topMost handle folder cleanup', () => {
      const diff: DiffMap = new Map([
        [stringToRel('src/old'), diffEntry('src/old', 'removed', 'folder')],
        [stringToRel('src/old/deep'), diffEntry('src/old/deep', 'removed', 'folder')],
        [stringToRel('test/old'), diffEntry('test/old', 'removed', 'folder')],
      ]);

      const { removedDirs } = partitionChangesUnder(diff, stringToRel(''));
      
      assert.equal(removedDirs.length, 3);

      const topDirs = topMost(removedDirs);
      
      assert.equal(topDirs.length, 2); // src/old and test/old
      assert.ok(topDirs.includes(stringToRel('src/old')));
      assert.ok(topDirs.includes(stringToRel('test/old')));
    });

    it('status helpers correctly classify all entries', () => {
      const statuses: DiffStatus[] = ['added', 'removed', 'modified', 'unchanged', 'conflict'];

      for (const status of statuses) {
        const canUpload = isUploadable(status);
        const canDelete = isDeletable(status);
        const canDownload = isDownloadable(status);
        const canResolve = isResolvable(status);

        // Each status should have at least one valid action
        const hasAction = canUpload || canDelete || canDownload || canResolve;
        assert.ok(hasAction, `Status ${status} should have at least one valid action`);
      }
    });
  });
});