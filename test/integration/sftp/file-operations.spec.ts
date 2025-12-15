import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SftpRemotePort } from '../../../src/infrastructure/remote/SftpRemotePort';
import { WorkspaceConfigService } from '../../../src/infrastructure/config/WorkspaceConfigService';
import { stringToWsId, stringToRel } from '../../../src/infrastructure/helpers/path';
import { sha256OfFile } from '../../../src/infrastructure/helpers/hash';
import { VM_CONFIG, cleanupRemotePath, REMOTE_PATHS, setupVMTests } from '../../helpers/vm/config';
import type { WorkspaceId } from '../../../src/domain/types';

describe('SFTP File Operations', function() {
  this.timeout(30000);

  let configService: WorkspaceConfigService;
  let remote: SftpRemotePort;
  const testWorkspaceId: WorkspaceId = stringToWsId('/test-workspace');
  const tempFiles: string[] = [];

  before(async function() {
    await setupVMTests(this);
  });

  beforeEach(async function() {
    configService = {
      getById: async () => ({
        hasRemote: true,
        data: {
          hostname: VM_CONFIG.hostname,
          port: VM_CONFIG.port,
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      }),
    } as any;

    remote = new SftpRemotePort(configService, 4);
    
    try {
      await cleanupRemotePath(REMOTE_PATHS.batch);  // ← Note: .batch not .integration!
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err instanceof Error ? err.message : 'unknown'}`);
      this.skip();
    }
  });

  afterEach(async () => {
    remote.dispose();
    
    // Cleanup temp files
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch {}
    }
    tempFiles.length = 0;
  });

  // Helper to create temp file
  const createTempFile = async (content: string): Promise<string> => {
    const tmpPath = path.join(os.tmpdir(), `livesync-test-${Date.now()}-${Math.random()}.txt`);
    await fs.writeFile(tmpPath, content, 'utf8');
    tempFiles.push(tmpPath);
    return tmpPath;
  };

  describe('Upload Operations', () => {
    it('uploads file to remote', async () => {
      const content = 'Test file content';
      const localPath = await createTempFile(content);
      const relPath = stringToRel('test-file.txt');

      await remote.uploadFile(testWorkspaceId, relPath, localPath);

      // Verify file exists on remote by listing
      const index = await remote.list(testWorkspaceId);
      const fileEntry = index.get(relPath);

      assert.ok(fileEntry, 'File should exist in remote index');
      assert.equal(fileEntry.type, 'file');
    });

    it('uploads file with hash verification', async () => {
      const content = 'Content for hash test';
      const localPath = await createTempFile(content);
      const relPath = stringToRel('hash-test.txt');

      const localHash = await sha256OfFile(localPath);

      await remote.uploadFile(testWorkspaceId, relPath, localPath);

      // Get remote hash
      const remoteHash = await remote.getFileHash(testWorkspaceId, relPath);

      assert.equal(remoteHash, localHash, 'Remote hash should match local hash');
    });

    it('creates parent directories automatically', async () => {
      const content = 'Nested file';
      const localPath = await createTempFile(content);
      const relPath = stringToRel('deeply/nested/path/file.txt');

      await remote.uploadFile(testWorkspaceId, relPath, localPath);

      const index = await remote.list(testWorkspaceId);
      
      assert.ok(index.has(stringToRel('deeply')));
      assert.ok(index.has(stringToRel('deeply/nested')));
      assert.ok(index.has(stringToRel('deeply/nested/path')));
      assert.ok(index.has(relPath));
    });

    it('overwrites existing file', async () => {
      const relPath = stringToRel('overwrite.txt');
      
      // Upload version 1
      const v1 = await createTempFile('version 1');
      await remote.uploadFile(testWorkspaceId, relPath, v1);

      const hash1 = await remote.getFileHash(testWorkspaceId, relPath);

      // Upload version 2
      const v2 = await createTempFile('version 2 - different content');
      await remote.uploadFile(testWorkspaceId, relPath, v2);

      const hash2 = await remote.getFileHash(testWorkspaceId, relPath);

      assert.notEqual(hash1, hash2, 'Hash should change after overwrite');
    });

    it('handles files with special characters in name', async () => {
      const content = 'Special chars test';
      const localPath = await createTempFile(content);
      const relPath = stringToRel('file with spaces & special-chars.txt');

      await remote.uploadFile(testWorkspaceId, relPath, localPath);

      const index = await remote.list(testWorkspaceId);
      assert.ok(index.has(relPath));
    });

    it('handles large files (10MB)', async () => {
      const largeContent = 'x'.repeat(10 * 1024 * 1024); // 10MB
      const localPath = await createTempFile(largeContent);
      const relPath = stringToRel('large-file.txt');

      await remote.uploadFile(testWorkspaceId, relPath, localPath);

      const index = await remote.list(testWorkspaceId);
      const entry = index.get(relPath);
      
      assert.ok(entry);
      assert.equal(entry.type, 'file');
    }).timeout(60000);
  });

  describe('Download Operations', () => {
    it('downloads file from remote', async () => {
      // First upload a file
      const content = 'Download test content';
      const uploadPath = await createTempFile(content);
      const relPath = stringToRel('download-test.txt');

      await remote.uploadFile(testWorkspaceId, relPath, uploadPath);

      // Download to new location
      const downloadPath = path.join(os.tmpdir(), `download-${Date.now()}.txt`);
      tempFiles.push(downloadPath);

      await remote.downloadFile(testWorkspaceId, relPath, downloadPath);

      // Verify content
      const downloadedContent = await fs.readFile(downloadPath, 'utf8');
      assert.equal(downloadedContent, content);
    });

    it('downloads file with hash verification', async () => {
      const content = 'Hash verification test';
      const uploadPath = await createTempFile(content);
      const relPath = stringToRel('hash-download.txt');

      const originalHash = await sha256OfFile(uploadPath);

      await remote.uploadFile(testWorkspaceId, relPath, uploadPath);

      const downloadPath = path.join(os.tmpdir(), `download-hash-${Date.now()}.txt`);
      tempFiles.push(downloadPath);

      await remote.downloadFile(testWorkspaceId, relPath, downloadPath);

      const downloadedHash = await sha256OfFile(downloadPath);

      assert.equal(downloadedHash, originalHash, 'Downloaded file hash should match original');
    });

    it('creates local parent directories automatically', async () => {
      const content = 'Nested download test';
      const uploadPath = await createTempFile(content);
      const relPath = stringToRel('file.txt');

      await remote.uploadFile(testWorkspaceId, relPath, uploadPath);

      // Download to nested local path that doesn't exist
      const downloadPath = path.join(os.tmpdir(), 'deep', 'nested', 'path', 'downloaded.txt');
      tempFiles.push(downloadPath);

      await remote.downloadFile(testWorkspaceId, relPath, downloadPath);

      const exists = await fs.access(downloadPath).then(() => true).catch(() => false);
      assert.ok(exists, 'Downloaded file should exist');
    });

    it('handles non-existent remote file gracefully', async () => {
      const relPath = stringToRel('does-not-exist.txt');
      const downloadPath = path.join(os.tmpdir(), `fail-${Date.now()}.txt`);

      await assert.rejects(
        async () => await remote.downloadFile(testWorkspaceId, relPath, downloadPath),
        /not found|no such file/i
      );
    });
  });

  describe('Delete Operations', () => {
    it('deletes file from remote', async () => {
      // Upload a file first
      const content = 'File to delete';
      const localPath = await createTempFile(content);
      const relPath = stringToRel('delete-me.txt');

      await remote.uploadFile(testWorkspaceId, relPath, localPath);

      // Verify it exists
      let index = await remote.list(testWorkspaceId);
      assert.ok(index.has(relPath));

      // Delete it
      await remote.deletePath(testWorkspaceId, relPath);

      // Verify it's gone
      index = await remote.list(testWorkspaceId);
      assert.ok(!index.has(relPath), 'File should be deleted');
    });

    it('deletes folder recursively', async () => {
      // Upload files in a folder
      const file1 = await createTempFile('file1');
      const file2 = await createTempFile('file2');

      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file1.txt'), file1);
      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file2.txt'), file2);

      // Delete the folder
      await remote.deletePath(testWorkspaceId, stringToRel('folder'));

      // Verify folder and files are gone
      const index = await remote.list(testWorkspaceId);
      assert.ok(!index.has(stringToRel('folder')));
      assert.ok(!index.has(stringToRel('folder/file1.txt')));
      assert.ok(!index.has(stringToRel('folder/file2.txt')));
    });

    it('handles deleting non-existent path gracefully', async () => {
      const relPath = stringToRel('does-not-exist.txt');

      // Should not throw (idempotent delete)
      await remote.deletePath(testWorkspaceId, relPath);
    });

    it('deletes nested folder structure', async () => {
      // Create deep nesting
      const file = await createTempFile('nested');
      await remote.uploadFile(testWorkspaceId, stringToRel('a/b/c/d/file.txt'), file);

      // Delete from top
      await remote.deletePath(testWorkspaceId, stringToRel('a'));

      // Verify all gone
      const index = await remote.list(testWorkspaceId);
      assert.ok(!index.has(stringToRel('a')));
      assert.ok(!index.has(stringToRel('a/b/c/d/file.txt')));
    });
  });

  describe('Edge Cases', () => {
    it('handles empty file', async () => {
      const emptyFile = await createTempFile('');
      const relPath = stringToRel('empty.txt');

      await remote.uploadFile(testWorkspaceId, relPath, emptyFile);

      const index = await remote.list(testWorkspaceId);
      assert.ok(index.has(relPath));
    });

    it('handles file with only whitespace', async () => {
      const whitespaceFile = await createTempFile('   \n\n\t\t   ');
      const relPath = stringToRel('whitespace.txt');

      await remote.uploadFile(testWorkspaceId, relPath, whitespaceFile);

      const downloadPath = path.join(os.tmpdir(), `ws-${Date.now()}.txt`);
      tempFiles.push(downloadPath);

      await remote.downloadFile(testWorkspaceId, relPath, downloadPath);

      const content = await fs.readFile(downloadPath, 'utf8');
      assert.equal(content, '   \n\n\t\t   ');
    });

    it('handles binary-like content', async () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
      const tmpPath = path.join(os.tmpdir(), `binary-${Date.now()}.bin`);
      await fs.writeFile(tmpPath, binaryContent);
      tempFiles.push(tmpPath);

      const relPath = stringToRel('binary.bin');

      await remote.uploadFile(testWorkspaceId, relPath, tmpPath);

      const downloadPath = path.join(os.tmpdir(), `binary-dl-${Date.now()}.bin`);
      tempFiles.push(downloadPath);

      await remote.downloadFile(testWorkspaceId, relPath, downloadPath);

      const downloaded = await fs.readFile(downloadPath);
      assert.deepEqual(downloaded, binaryContent);
    });
  });
});