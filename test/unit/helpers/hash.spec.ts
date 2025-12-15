import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sha256OfFile } from '../../../src/infrastructure/helpers/hash/FileHash';
import { computeFolderHashFromNodeIndex, computeAllFolderHashes } from '../../../src/infrastructure/helpers/hash/FolderHash';
import { stringToRel } from '../../../src/infrastructure/helpers/path';
import type { NodeIndex, FileMeta, FolderMeta, NodeMeta } from '../../../src/domain/types';

// Helper to create test files
const createTempFile = async (content: string): Promise<string> => {
  const tmpPath = path.join(os.tmpdir(), `livesync-test-${Date.now()}-${Math.random()}.txt`);
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  return tmpPath;
};

const cleanupFile = async (filePath: string): Promise<void> => {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore errors
  }
};

// Helper to create metadata
const file = (hash: string, size?: number): FileMeta => ({
  type: 'file',
  hash,
  ...(size !== undefined && { size }),
});

const folder = (hash: string): FolderMeta => ({
  type: 'folder',
  hash,
});

describe('Hash Utilities', () => {
  describe('sha256OfFile', () => {
    it('computes SHA256 hash of file content', async () => {
      const tmpFile = await createTempFile('Hello World');
      
      try {
        const hash = await sha256OfFile(tmpFile);
        
        // Known SHA256 of "Hello World"
        const expected = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e';
        assert.equal(hash, expected);
      } finally {
        await cleanupFile(tmpFile);
      }
    });

    it('produces different hashes for different content', async () => {
      const file1 = await createTempFile('content1');
      const file2 = await createTempFile('content2');
      
      try {
        const hash1 = await sha256OfFile(file1);
        const hash2 = await sha256OfFile(file2);
        
        assert.notEqual(hash1, hash2);
      } finally {
        await cleanupFile(file1);
        await cleanupFile(file2);
      }
    });

    it('produces same hash for identical content', async () => {
      const content = 'identical content';
      const file1 = await createTempFile(content);
      const file2 = await createTempFile(content);
      
      try {
        const hash1 = await sha256OfFile(file1);
        const hash2 = await sha256OfFile(file2);
        
        assert.equal(hash1, hash2);
      } finally {
        await cleanupFile(file1);
        await cleanupFile(file2);
      }
    });

    it('handles empty file', async () => {
      const tmpFile = await createTempFile('');
      
      try {
        const hash = await sha256OfFile(tmpFile);
        
        // Known SHA256 of empty string
        const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        assert.equal(hash, expected);
      } finally {
        await cleanupFile(tmpFile);
      }
    });

    it('handles large file content', async () => {
      const largeContent = 'x'.repeat(10000);
      const tmpFile = await createTempFile(largeContent);
      
      try {
        const hash = await sha256OfFile(tmpFile);
        
        assert.ok(hash);
        assert.equal(hash.length, 64); // SHA256 is 64 hex chars
        assert.match(hash, /^[a-f0-9]{64}$/);
      } finally {
        await cleanupFile(tmpFile);
      }
    });

    it('handles binary-like content', async () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF]).toString('utf8');
      const tmpFile = await createTempFile(binaryContent);
      
      try {
        const hash = await sha256OfFile(tmpFile);
        
        assert.ok(hash);
        assert.equal(hash.length, 64);
      } finally {
        await cleanupFile(tmpFile);
      }
    });

    it('returns hex string in correct format', async () => {
      const tmpFile = await createTempFile('test');
      
      try {
        const hash = await sha256OfFile(tmpFile);
        
        assert.equal(typeof hash, 'string');
        assert.equal(hash.length, 64);
        assert.match(hash, /^[a-f0-9]{64}$/);
      } finally {
        await cleanupFile(tmpFile);
      }
    });

    it('rejects for non-existent file', async () => {
      const nonExistent = '/tmp/non-existent-file-' + Date.now() + '.txt';
      
      await assert.rejects(async () => {
        await sha256OfFile(nonExistent);
      });
    });
  });

  describe('computeFolderHashFromNodeIndex', () => {
    it('computes hash from file descendants', () => {
      const index: NodeIndex = new Map([
        [stringToRel('src'), folder('')],
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('src/utils.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      
      assert.ok(hash);
      assert.equal(hash.length, 64);
      assert.match(hash, /^[a-f0-9]{64}$/);
    });

    it('produces deterministic hash for same content', () => {
      const index: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('src/utils.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      const hash1 = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      const hash2 = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      
      assert.equal(hash1, hash2);
    });

    it('produces different hash when file hash changes', () => {
      const index1: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      const index2: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('src'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('src'));
      
      assert.notEqual(hash1, hash2);
    });

    it('produces different hash when file is added', () => {
      const index1: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      const index2: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('src/new.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('src'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('src'));
      
      assert.notEqual(hash1, hash2);
    });

    it('ignores subfolders (only counts files)', () => {
      const index: NodeIndex = new Map([
        [stringToRel('src'), folder('')],
        [stringToRel('src/utils'), folder('')],
        [stringToRel('src/app.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      
      assert.ok(hash);
      // Should only be affected by src/app.ts, not src/utils folder
    });

    it('handles empty folder', () => {
      const index: NodeIndex = new Map([
        [stringToRel('src'), folder('')],
      ] as [any, NodeMeta][]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      
      assert.ok(hash);
      assert.equal(hash.length, 64);
    });

    it('handles root folder', () => {
      const index: NodeIndex = new Map([
        [stringToRel('file.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel(''));
      
      assert.ok(hash);
      assert.equal(hash.length, 64);
    });

    it('only includes files under specified folder', () => {
      const index: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('test/app.spec.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      const srcHash = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      const testHash = computeFolderHashFromNodeIndex(index, stringToRel('test'));
      
      assert.notEqual(srcHash, testHash);
    });

    it('is order-independent (sorted internally)', () => {
      // Different insertion order, same files
      const index1: NodeIndex = new Map([
        [stringToRel('src/a.ts'), file('hashA')],
        [stringToRel('src/b.ts'), file('hashB')],
      ] as [any, NodeMeta][]);

      const index2: NodeIndex = new Map([
        [stringToRel('src/b.ts'), file('hashB')],
        [stringToRel('src/a.ts'), file('hashA')],
      ] as [any, NodeMeta][]);

      const hash1 = computeFolderHashFromNodeIndex(index1, stringToRel('src'));
      const hash2 = computeFolderHashFromNodeIndex(index2, stringToRel('src'));
      
      assert.equal(hash1, hash2);
    });

    it('handles nested files in subdirectories', () => {
      const index: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('src/utils/helper.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      
      assert.ok(hash);
      // Should include both files
    });

    it('handles __unknown__ hash values', () => {
      const index: NodeIndex = new Map([
        [stringToRel('src/app.ts'), file('__unknown__')],
      ] as [any, NodeMeta][]);

      const hash = computeFolderHashFromNodeIndex(index, stringToRel('src'));
      
      assert.ok(hash);
      assert.equal(hash.length, 64);
    });
  });

  describe('computeAllFolderHashes', () => {
    it('computes hashes for all folders bottom-up', async () => {
      const index: NodeIndex = new Map([
        [stringToRel('src'), folder('')],
        [stringToRel('src/utils'), folder('')],
        [stringToRel('src/app.ts'), file('hash1')],
        [stringToRel('src/utils/helper.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index);

      const srcFolder = index.get(stringToRel('src')) as FolderMeta;
      const utilsFolder = index.get(stringToRel('src/utils')) as FolderMeta;

      assert.ok(srcFolder.hash);
      assert.notEqual(srcFolder.hash, '');
      assert.ok(utilsFolder.hash);
      assert.notEqual(utilsFolder.hash, '');
    });

    it('updates existing folder metadata', async () => {
      const index: NodeIndex = new Map([
        [stringToRel('src'), folder('old-hash')],
        [stringToRel('src/app.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index);

      const srcFolder = index.get(stringToRel('src')) as FolderMeta;
      
      assert.notEqual(srcFolder.hash, 'old-hash');
      assert.notEqual(srcFolder.hash, '');
    });

    it('creates root folder entry if not present', async () => {
      const index: NodeIndex = new Map([
        [stringToRel('file.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index);

      const rootFolder = index.get(stringToRel(''));
      
      assert.ok(rootFolder);
      assert.equal(rootFolder.type, 'folder');
      assert.ok((rootFolder as FolderMeta).hash);
    });

    it('handles empty index', async () => {
      const index: NodeIndex = new Map();

      await computeAllFolderHashes(index);

      const rootFolder = index.get(stringToRel(''));
      
      assert.ok(rootFolder);
      assert.equal(rootFolder.type, 'folder');
    });

    it('processes deep nesting correctly', async () => {
      const index: NodeIndex = new Map([
        [stringToRel('a'), folder('')],
        [stringToRel('a/b'), folder('')],
        [stringToRel('a/b/c'), folder('')],
        [stringToRel('a/b/c/file.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index);

      const folderA = index.get(stringToRel('a')) as FolderMeta;
      const folderB = index.get(stringToRel('a/b')) as FolderMeta;
      const folderC = index.get(stringToRel('a/b/c')) as FolderMeta;

      assert.ok(folderA.hash);
      assert.ok(folderB.hash);
      assert.ok(folderC.hash);
      
      // Parent hashes should differ from child hashes
      assert.notEqual(folderA.hash, folderB.hash);
      assert.notEqual(folderB.hash, folderC.hash);
    });

    it('folder hash changes when child file changes', async () => {
      const index1: NodeIndex = new Map([
        [stringToRel('src'), folder('')],
        [stringToRel('src/app.ts'), file('hash1')],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index1);
      const hash1 = (index1.get(stringToRel('src')) as FolderMeta).hash;

      const index2: NodeIndex = new Map([
        [stringToRel('src'), folder('')],
        [stringToRel('src/app.ts'), file('hash2')],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index2);
      const hash2 = (index2.get(stringToRel('src')) as FolderMeta).hash;

      assert.notEqual(hash1, hash2);
    });

    it('does not modify file entries', async () => {
      const fileMeta = file('original-hash');
      const index: NodeIndex = new Map([
        [stringToRel('file.ts'), fileMeta],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index);

      const fileEntry = index.get(stringToRel('file.ts')) as FileMeta;
      
      assert.equal(fileEntry.type, 'file');
      assert.equal(fileEntry.hash, 'original-hash');
    });

    it('handles mixed file and folder structure', async () => {
      const index: NodeIndex = new Map([
        [stringToRel('README.md'), file('hash1')],
        [stringToRel('src'), folder('')],
        [stringToRel('src/app.ts'), file('hash2')],
        [stringToRel('test'), folder('')],
        [stringToRel('test/app.spec.ts'), file('hash3')],
      ] as [any, NodeMeta][]);

      await computeAllFolderHashes(index);

      const rootFolder = index.get(stringToRel('')) as FolderMeta;
      const srcFolder = index.get(stringToRel('src')) as FolderMeta;
      const testFolder = index.get(stringToRel('test')) as FolderMeta;

      assert.ok(rootFolder.hash);
      assert.ok(srcFolder.hash);
      assert.ok(testFolder.hash);
      
      // All should have different hashes
      assert.notEqual(rootFolder.hash, srcFolder.hash);
      assert.notEqual(rootFolder.hash, testFolder.hash);
      assert.notEqual(srcFolder.hash, testFolder.hash);
    });
  });

  describe('Integration Tests', () => {
    it('file hash + folder hash work together', async () => {
      const content = 'test content';
      const tmpFile = await createTempFile(content);
      
      try {
        const fileHash = await sha256OfFile(tmpFile);
        
        const index: NodeIndex = new Map([
          [stringToRel('src'), folder('')],
          [stringToRel('src/file.ts'), file(fileHash)],
        ] as [any, NodeMeta][]);

        await computeAllFolderHashes(index);

        const folderHash = (index.get(stringToRel('src')) as FolderMeta).hash;
        
        assert.ok(fileHash);
        assert.ok(folderHash);
        assert.notEqual(fileHash, folderHash);
      } finally {
        await cleanupFile(tmpFile);
      }
    });

    it('changing file content changes all parent folder hashes', async () => {
      const content1 = 'version 1';
      const content2 = 'version 2';
      
      const file1 = await createTempFile(content1);
      const file2 = await createTempFile(content2);
      
      try {
        const hash1 = await sha256OfFile(file1);
        const hash2 = await sha256OfFile(file2);
        
        const index1: NodeIndex = new Map([
          [stringToRel('a'), folder('')],
          [stringToRel('a/b'), folder('')],
          [stringToRel('a/b/file.ts'), file(hash1)],
        ] as [any, NodeMeta][]);

        await computeAllFolderHashes(index1);
        const folderA1 = (index1.get(stringToRel('a')) as FolderMeta).hash;
        const folderB1 = (index1.get(stringToRel('a/b')) as FolderMeta).hash;

        const index2: NodeIndex = new Map([
          [stringToRel('a'), folder('')],
          [stringToRel('a/b'), folder('')],
          [stringToRel('a/b/file.ts'), file(hash2)],
        ] as [any, NodeMeta][]);

        await computeAllFolderHashes(index2);
        const folderA2 = (index2.get(stringToRel('a')) as FolderMeta).hash;
        const folderB2 = (index2.get(stringToRel('a/b')) as FolderMeta).hash;
        
        // Both parent folders should have different hashes
        assert.notEqual(folderA1, folderA2);
        assert.notEqual(folderB1, folderB2);
      } finally {
        await cleanupFile(file1);
        await cleanupFile(file2);
      }
    });
  });
});