import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SftpRemotePort } from '@infra/remote/SftpRemotePort';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { stringToWsId, stringToRel } from '@helpers/path';
import { VM_CONFIG, cleanupRemotePath, REMOTE_PATHS, setupVMTests } from '../../helpers/vm/config';
import type { WorkspaceId } from '@domain/types';

describe('SFTP File Operations', function() {
  this.timeout(30000);

  let configService: WorkspaceConfigService;
  let remote: SftpRemotePort;
  let localTempDir: string;
  const testWorkspaceId: WorkspaceId = stringToWsId('/test-workspace');

  before(async function() {
    await setupVMTests(this);
  });

  beforeEach(async function() {
    // Create temp local directory
    localTempDir = path.join(os.tmpdir(), `livesync-sftp-test-${Date.now()}`);
    await fs.mkdir(localTempDir, { recursive: true });

    // Setup config service mock
    configService = {
      getById: async () => ({
        hasRemote: true,
        data: {
          hostname: VM_CONFIG.hostname,
          port: VM_CONFIG.port,
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          privateKeyPath: VM_CONFIG.privateKeyPath || '',
          passphrase: VM_CONFIG.passphrase || '',
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      }),
    } as any;

    remote = new SftpRemotePort(configService, 4);
    
    // Clean remote directory
    try {
      await cleanupRemotePath(REMOTE_PATHS.integration);
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  afterEach(async () => {
    remote.dispose();
    await fs.rm(localTempDir, { recursive: true, force: true });
  });

  it('uploads file to remote and verifies', async () => {
    const localFile = path.join(localTempDir, 'test-upload.txt');
    const content = 'Upload test content';
    await fs.writeFile(localFile, content);

    const relPath = stringToRel('test-upload.txt');

    // Upload
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Verify file exists on remote using list()
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.has(relPath), 'File should exist in remote index');

    const fileMeta = index.get(relPath);
    assert.ok(fileMeta, 'File metadata should exist');
    assert.equal(fileMeta.type, 'file', 'Should be a file');

    // Verify content by downloading and comparing
    const downloadedFile = path.join(localTempDir, 'test-upload-downloaded.txt');
    await remote.downloadFile(testWorkspaceId, relPath, downloadedFile);
    
    const downloadedContent = await fs.readFile(downloadedFile, 'utf-8');
    assert.equal(downloadedContent, content, 'Downloaded content should match original');
  });

  it('downloads file from remote and verifies content', async () => {
    // First upload a file to have something to download
    const content = 'Download test content';
    const uploadFile = path.join(localTempDir, 'for-download.txt');
    await fs.writeFile(uploadFile, content);
    
    const relPath = stringToRel('test-download.txt');
    await remote.uploadFile(testWorkspaceId, relPath, uploadFile);

    // Download to different location
    const downloadFile = path.join(localTempDir, 'test-download-result.txt');
    await remote.downloadFile(testWorkspaceId, relPath, downloadFile);

    // Verify local file exists and has correct content
    const localContent = await fs.readFile(downloadFile, 'utf-8');
    assert.equal(localContent, content, 'Downloaded content should match original');
  });

  it('deletes file from remote and verifies deletion', async () => {
    // Upload a file first
    const content = 'Delete me';
    const uploadFile = path.join(localTempDir, 'to-delete.txt');
    await fs.writeFile(uploadFile, content);
    
    const relPath = stringToRel('test-delete.txt');
    await remote.uploadFile(testWorkspaceId, relPath, uploadFile);

    // Verify exists before delete
    let index = await remote.list(testWorkspaceId);
    assert.ok(index.has(relPath), 'File should exist before delete');

    // Delete
    await remote.deletePath(testWorkspaceId, relPath);

    // Verify deleted
    index = await remote.list(testWorkspaceId);
    assert.ok(!index.has(relPath), 'File should be deleted from remote');
  });

  it('uploads binary file correctly', async () => {
    const localFile = path.join(localTempDir, 'binary.bin');
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD, 0x89, 0x50, 0x4E, 0x47]);
    await fs.writeFile(localFile, binaryData);

    // Upload
    await remote.uploadFile(testWorkspaceId, stringToRel('binary.bin'), localFile);

    // Download and verify
    const downloadedFile = path.join(localTempDir, 'binary-downloaded.bin');
    await remote.downloadFile(testWorkspaceId, stringToRel('binary.bin'), downloadedFile);

    const downloadedData = await fs.readFile(downloadedFile);
    assert.deepEqual(downloadedData, binaryData, 'Binary data should match exactly');
  });

  it('handles nested directories on upload', async () => {
    const localFile = path.join(localTempDir, 'nested', 'deep', 'file.txt');
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(localFile, 'nested content');

    // Upload
    const relPath = stringToRel('nested/deep/file.txt');
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Verify using list()
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.has(relPath), 'Nested file should exist on remote');
    assert.ok(index.has(stringToRel('nested')), 'Parent folder should exist');
    assert.ok(index.has(stringToRel('nested/deep')), 'Intermediate folder should exist');
  });

  it('creates remote directories if missing', async () => {
    const localFile = path.join(localTempDir, 'file.txt');
    await fs.writeFile(localFile, 'content');

    // Upload to new directory path
    const relPath = stringToRel('new/folder/file.txt');
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Verify directory structure was created
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.has(stringToRel('new')), 'Top-level directory should be created');
    assert.ok(index.has(stringToRel('new/folder')), 'Intermediate directory should be created');
    assert.ok(index.has(relPath), 'File should exist in new directory');
  });

  it('handles large files (1MB)', async function() {
    this.timeout(60000);
    
    const localFile = path.join(localTempDir, 'large-file.bin');
    const largeData = Buffer.alloc(1024 * 1024); // 1MB
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }
    await fs.writeFile(localFile, largeData);

    const relPath = stringToRel('large-file.bin');

    // Upload
    const startUpload = Date.now();
    await remote.uploadFile(testWorkspaceId, relPath, localFile);
    const uploadTime = Date.now() - startUpload;

    console.log(`Upload 1MB: ${uploadTime}ms`);

    // Verify file exists
    const index = await remote.list(testWorkspaceId);
    const fileMeta = index.get(relPath);
    assert.ok(fileMeta, 'Large file should exist on remote');
    assert.equal(fileMeta.type, 'file');
    
    if (fileMeta.type === 'file' && fileMeta.size !== undefined) {
      assert.ok(fileMeta.size >= 1024 * 1024, 'File size should be at least 1MB');
    }

    // Download and verify integrity
    const downloadedFile = path.join(localTempDir, 'large-downloaded.bin');
    const startDownload = Date.now();
    await remote.downloadFile(testWorkspaceId, relPath, downloadedFile);
    const downloadTime = Date.now() - startDownload;

    console.log(`Download 1MB: ${downloadTime}ms`);

    // Verify size matches
    const downloadedData = await fs.readFile(downloadedFile);
    assert.equal(downloadedData.length, largeData.length, 'File size should match');
  });

  it('overwrites existing remote file on upload', async () => {
    const localFile = path.join(localTempDir, 'overwrite.txt');
    const content1 = 'original content';
    const content2 = 'updated content';

    const relPath = stringToRel('overwrite.txt');

    // First upload
    await fs.writeFile(localFile, content1);
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Get first hash
    const hash1 = await remote.getFileHash(testWorkspaceId, relPath);

    // Second upload with different content
    await fs.writeFile(localFile, content2);
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Get second hash
    const hash2 = await remote.getFileHash(testWorkspaceId, relPath);

    // Hashes should be different
    assert.notEqual(hash1, hash2, 'File hash should change after overwrite');

    // Verify content was actually overwritten
    const downloadFile = path.join(localTempDir, 'overwrite-verify.txt');
    await remote.downloadFile(testWorkspaceId, relPath, downloadFile);
    const downloadedContent = await fs.readFile(downloadFile, 'utf-8');
    assert.equal(downloadedContent, content2, 'File should be overwritten with new content');
  });

  it('handles files with special characters in names', async () => {
    const localFile = path.join(localTempDir, 'file-with-spaces and special chars.txt');
    await fs.writeFile(localFile, 'special content');

    const relPath = stringToRel('file-with-spaces and special chars.txt');

    // Upload
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Verify using list()
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.has(relPath), 'File with special chars should exist');
  });

  it('handles empty files', async () => {
    const localFile = path.join(localTempDir, 'empty.txt');
    await fs.writeFile(localFile, '');

    const relPath = stringToRel('empty.txt');

    // Upload
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Verify file exists
    const index = await remote.list(testWorkspaceId);
    const fileMeta = index.get(relPath);
    
    assert.ok(fileMeta, 'Empty file should exist');
    assert.equal(fileMeta.type, 'file');
    
    // Download and verify it's empty
    const downloadFile = path.join(localTempDir, 'empty-downloaded.txt');
    await remote.downloadFile(testWorkspaceId, relPath, downloadFile);
    
    const content = await fs.readFile(downloadFile, 'utf-8');
    assert.equal(content, '', 'Downloaded file should be empty');
  });

  it('deletes non-existent file without error', async () => {
    const relPath = stringToRel('does-not-exist.txt');
    
    // Verify it doesn't exist
    let index = await remote.list(testWorkspaceId);
    assert.ok(!index.has(relPath), 'File should not exist initially');
    
    // Try to delete file that doesn't exist - should not throw
    await remote.deletePath(testWorkspaceId, relPath);

    // Verify it still doesn't exist
    index = await remote.list(testWorkspaceId);
    assert.ok(!index.has(relPath), 'File should still not exist');
  });

  it('handles concurrent uploads to different files', async () => {
    const uploads = [];
    for (let i = 0; i < 5; i++) {
      const localFile = path.join(localTempDir, `concurrent-${i}.txt`);
      await fs.writeFile(localFile, `content ${i}`);
      
      uploads.push(
        remote.uploadFile(testWorkspaceId, stringToRel(`concurrent-${i}.txt`), localFile)
      );
    }

    // All uploads should succeed
    await Promise.all(uploads);

    // Verify all files exist
    const index = await remote.list(testWorkspaceId);
    for (let i = 0; i < 5; i++) {
      const relPath = stringToRel(`concurrent-${i}.txt`);
      assert.ok(index.has(relPath), `File concurrent-${i}.txt should exist`);
    }
  });

  it('uploads executable files', async function() {
    // Skip on Windows (no chmod)
    if (process.platform === 'win32') {
      this.skip();
      return;
    }

    const localFile = path.join(localTempDir, 'executable.sh');
    await fs.writeFile(localFile, '#!/bin/bash\necho "test"');
    await fs.chmod(localFile, 0o755);

    const relPath = stringToRel('executable.sh');

    // Upload
    await remote.uploadFile(testWorkspaceId, relPath, localFile);

    // Verify file exists and can be downloaded
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.has(relPath), 'Executable file should exist');

    // Download and verify content
    const downloadFile = path.join(localTempDir, 'executable-downloaded.sh');
    await remote.downloadFile(testWorkspaceId, relPath, downloadFile);
    
    const content = await fs.readFile(downloadFile, 'utf-8');
    assert.ok(content.includes('#!/bin/bash'), 'Executable content should be preserved');
  });
});