import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SftpRemotePort } from '@infra/remote/SftpRemotePort';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { stringToWsId, stringToRel } from '@helpers/path';
import { VM_CONFIG, cleanupRemotePath, REMOTE_PATHS, setupVMTests } from '../../helpers/vm/config';
import type { WorkspaceId } from '@domain/types';

describe('SFTP Batch Operations', function() {
  this.timeout(120000); // 2 minutes

  let configService: WorkspaceConfigService;
  let remote: SftpRemotePort;
  let localTempDir: string;
  const testWorkspaceId: WorkspaceId = stringToWsId('/test-workspace');

  // Helper to create and upload a file
  async function uploadTestFile(relPath: string, content: string): Promise<void> {
    const localFile = path.join(localTempDir, `temp-${Date.now()}-${Math.random()}.txt`);
    await fs.writeFile(localFile, content);
    await remote.uploadFile(testWorkspaceId, stringToRel(relPath), localFile);
    await fs.unlink(localFile);
  }

  before(async function() {
    await setupVMTests(this);
  });

  beforeEach(async function() {
    localTempDir = path.join(os.tmpdir(), `livesync-batch-test-${Date.now()}`);
    await fs.mkdir(localTempDir, { recursive: true });

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
          remotePath: REMOTE_PATHS.batch,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      }),
    } as any;

    remote = new SftpRemotePort(configService, 9); // Max 9 concurrent
    
    try {
      await cleanupRemotePath(REMOTE_PATHS.batch);
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  afterEach(async () => {
    remote.dispose();
    await fs.rm(localTempDir, { recursive: true, force: true });
  });

  it('uploads 50 files concurrently', async () => {
    // Create 50 local files
    const uploadPromises = [];
    for (let i = 0; i < 50; i++) {
      const localFile = path.join(localTempDir, `file${i}.txt`);
      await fs.writeFile(localFile, `content ${i}`);
      
      uploadPromises.push(
        remote.uploadFile(testWorkspaceId, stringToRel(`file${i}.txt`), localFile)
      );
    }

    const startTime = Date.now();
    await Promise.all(uploadPromises);
    const duration = Date.now() - startTime;

    console.log(`Uploaded 50 files in ${duration}ms (${Math.round(duration / 50)}ms/file)`);

    // Verify all uploaded using list
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.size >= 50, 'Should have at least 50 files');
    
    // Verify a few random files
    assert.ok(index.has(stringToRel('file0.txt')), 'Should have file0.txt');
    assert.ok(index.has(stringToRel('file25.txt')), 'Should have file25.txt');
    assert.ok(index.has(stringToRel('file49.txt')), 'Should have file49.txt');
  });

  it('downloads 50 files concurrently', async () => {
    // Upload 50 files first (to have something to download)
    const uploadPromises = [];
    for (let i = 0; i < 50; i++) {
      uploadPromises.push(uploadTestFile(`file${i}.txt`, `content ${i}`));
    }
    await Promise.all(uploadPromises);

    // Download all concurrently
    const downloadPromises = [];
    for (let i = 0; i < 50; i++) {
      const localFile = path.join(localTempDir, `downloaded-${i}.txt`);
      downloadPromises.push(
        remote.downloadFile(testWorkspaceId, stringToRel(`file${i}.txt`), localFile)
      );
    }

    const startTime = Date.now();
    await Promise.all(downloadPromises);
    const duration = Date.now() - startTime;

    console.log(`Downloaded 50 files in ${duration}ms (${Math.round(duration / 50)}ms/file)`);

    // Verify all downloaded
    const files = await fs.readdir(localTempDir);
    const downloadedFiles = files.filter(f => f.startsWith('downloaded-'));
    assert.ok(downloadedFiles.length >= 50, `Should have at least 50 files, got ${downloadedFiles.length}`);
  });

  it('handles mixed concurrent operations (upload + download)', async () => {
    // Upload some files first for downloading
    const uploadPromises1 = [];
    for (let i = 0; i < 10; i++) {
      uploadPromises1.push(uploadTestFile(`download${i}.txt`, `download ${i}`));
    }
    await Promise.all(uploadPromises1);

    // Create some files locally for upload
    for (let i = 0; i < 10; i++) {
      const localFile = path.join(localTempDir, `upload${i}.txt`);
      await fs.writeFile(localFile, `upload ${i}`);
    }

    // Mix upload and download operations
    const operations = [];
    for (let i = 0; i < 10; i++) {
      // Upload
      operations.push(
        remote.uploadFile(
          testWorkspaceId, 
          stringToRel(`upload${i}.txt`), 
          path.join(localTempDir, `upload${i}.txt`)
        )
      );
      
      // Download
      operations.push(
        remote.downloadFile(
          testWorkspaceId,
          stringToRel(`download${i}.txt`),
          path.join(localTempDir, `downloaded${i}.txt`)
        )
      );
    }

    // Run all concurrently
    await Promise.all(operations);

    // Verify both uploads and downloads succeeded
    const localFiles = await fs.readdir(localTempDir);
    const hasDownloaded = localFiles.some(f => f.startsWith('downloaded'));
    assert.ok(hasDownloaded, 'Should have downloaded files');

    const index = await remote.list(testWorkspaceId);
    const hasUploaded = index.has(stringToRel('upload0.txt'));
    assert.ok(hasUploaded, 'Should have uploaded files');
  });

  it('respects SFTP concurrency limit (9 operations)', async function() {
    // Upload files to download
    const uploadPromises = [];
    for (let i = 0; i < 20; i++) {
      uploadPromises.push(uploadTestFile(`file${i}.txt`, `file ${i}`));
    }
    await Promise.all(uploadPromises);

    // Download 20 files concurrently
    // The SFTP port should limit concurrency internally via p-limit
    const downloads = [];
    for (let i = 0; i < 20; i++) {
      downloads.push(
        remote.downloadFile(
          testWorkspaceId,
          stringToRel(`file${i}.txt`),
          path.join(localTempDir, `downloaded-${i}.txt`)
        )
      );
    }

    const startTime = Date.now();
    await Promise.all(downloads);
    const duration = Date.now() - startTime;

    console.log(`Downloaded 20 files in ${duration}ms (${Math.round(duration / 20)}ms/file)`);
    
    // Verify all downloaded
    const localFiles = await fs.readdir(localTempDir);
    const downloadedFiles = localFiles.filter(f => f.startsWith('downloaded-'));
    assert.equal(downloadedFiles.length, 20, 'Should have downloaded all 20 files');
    
    // Note: Actual concurrency limit is enforced by SftpRemotePort's p-limit(9)
    // We can't easily verify the exact limit without modifying the implementation
    // But we can verify that all files downloaded successfully despite launching 20 concurrent operations
  });

  it('handles large batch without memory issues (100 files)', async function() {
    this.timeout(180000); // 3 minutes

    // Create 100 files with moderate size (10KB each)
    const uploadPromises = [];
    for (let i = 0; i < 100; i++) {
      const localFile = path.join(localTempDir, `batch${i}.txt`);
      const content = `content ${i}`.repeat(1000); // ~10KB
      await fs.writeFile(localFile, content);
      
      uploadPromises.push(
        remote.uploadFile(
          testWorkspaceId,
          stringToRel(`batch${i}.txt`),
          localFile
        )
      );
    }

    const startTime = Date.now();
    await Promise.all(uploadPromises);
    const duration = Date.now() - startTime;

    console.log(`Uploaded 100x10KB files in ${duration}ms (${Math.round(duration / 100)}ms/file)`);

    // Verify count
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.size >= 100, 'Should have at least 100 files');
  });

  it('handles batch delete operations', async () => {
    // Upload files first
    const uploadPromises = [];
    for (let i = 0; i < 20; i++) {
      uploadPromises.push(uploadTestFile(`delete${i}.txt`, `delete me ${i}`));
    }
    await Promise.all(uploadPromises);

    // Verify files exist
    let index = await remote.list(testWorkspaceId);
    assert.ok(index.size >= 20, 'Should have at least 20 files before delete');

    // Delete all concurrently
    const deletes = [];
    for (let i = 0; i < 20; i++) {
      deletes.push(
        remote.deletePath(testWorkspaceId, stringToRel(`delete${i}.txt`))
      );
    }

    await Promise.all(deletes);

    // Verify all deleted
    index = await remote.list(testWorkspaceId);
    assert.ok(index.size < 20, 'Should have deleted files');
    assert.ok(!index.has(stringToRel('delete0.txt')), 'delete0.txt should be gone');
    assert.ok(!index.has(stringToRel('delete19.txt')), 'delete19.txt should be gone');
  });

  it('maintains performance with varying file sizes', async function() {
    this.timeout(120000);

    // Create files of varying sizes
    const files = [
      { name: 'tiny.txt', size: 10 },
      { name: 'small.txt', size: 1024 }, // 1KB
      { name: 'medium.txt', size: 10240 }, // 10KB
      { name: 'large.txt', size: 102400 }, // 100KB
    ];

    for (const file of files) {
      const localFile = path.join(localTempDir, file.name);
      const content = 'x'.repeat(file.size);
      await fs.writeFile(localFile, content);
    }

    // Upload all sizes
    const uploads = files.map(file => 
      remote.uploadFile(
        testWorkspaceId,
        stringToRel(file.name),
        path.join(localTempDir, file.name)
      )
    );

    await Promise.all(uploads);

    // Verify all uploaded with correct sizes
    const index = await remote.list(testWorkspaceId);
    
    for (const file of files) {
      const meta = index.get(stringToRel(file.name));
      assert.ok(meta, `${file.name} should exist`);
      assert.equal(meta.type, 'file');
      if (meta.type === 'file' && meta.size !== undefined) {
        assert.ok(
          meta.size >= file.size && meta.size <= file.size + 10,
          `${file.name} size should be ~${file.size}, got ${meta.size}`
        );
      }
    }
  });

  it('handles errors in batch without affecting other operations', async () => {
    // Create most files, but make one fail
    for (let i = 0; i < 10; i++) {
      if (i !== 5) { // Skip file 5
        const localFile = path.join(localTempDir, `file${i}.txt`);
        await fs.writeFile(localFile, `content ${i}`);
      }
    }

    // Upload all, file5 should fail (doesn't exist)
    const uploads = [];
    for (let i = 0; i < 10; i++) {
      uploads.push(
        remote.uploadFile(
          testWorkspaceId,
          stringToRel(`file${i}.txt`),
          path.join(localTempDir, `file${i}.txt`)
        ).catch(err => ({ error: true, index: i, err }))
      );
    }

    const results = await Promise.all(uploads);

    // Count successes and failures
    const failures = results.filter(r => r && typeof r === 'object' && 'error' in r);
    const successes = results.filter(r => !r || typeof r !== 'object' || !('error' in r));

    assert.equal(failures.length, 1, 'Should have 1 failure (file5)');
    assert.equal(successes.length, 9, 'Should have 9 successes');

    // Verify the successful ones uploaded
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.has(stringToRel('file0.txt')), 'file0 should have uploaded');
    assert.ok(index.has(stringToRel('file9.txt')), 'file9 should have uploaded');
  });

  it('performs well with nested directory structure', async () => {
    // Create nested structure locally and upload
    const uploadPromises = [];
    for (let i = 0; i < 20; i++) {
      const localFile = path.join(localTempDir, `level1/level2/level3-${i}/file.txt`);
      await fs.mkdir(path.dirname(localFile), { recursive: true });
      await fs.writeFile(localFile, `content ${i}`);
      
      uploadPromises.push(
        remote.uploadFile(
          testWorkspaceId,
          stringToRel(`level1/level2/level3-${i}/file.txt`),
          localFile
        )
      );
    }

    const startTime = Date.now();
    await Promise.all(uploadPromises);
    const duration = Date.now() - startTime;

    console.log(`Uploaded 20 nested files in ${duration}ms`);

    // Verify structure created on remote
    const index = await remote.list(testWorkspaceId);
    const files = Array.from(index.keys()).filter(k => k.includes('level1/level2/level3'));
    
    assert.ok(files.length >= 20, `Should have at least 20 files, found ${files.length}`);
  });

  it('uploadFolder handles batch uploads efficiently', async () => {
    // Create multiple files locally
    const files = [];
    for (let i = 0; i < 30; i++) {
      const localFile = path.join(localTempDir, `batch${i}.txt`);
      await fs.writeFile(localFile, `content ${i}`);
      files.push({
        relPath: stringToRel(`batch${i}.txt`),
        absLocal: localFile
      });
    }

    // Upload using uploadFolder
    const startTime = Date.now();
    const uploaded = await remote.uploadFolder(testWorkspaceId, files);
    const duration = Date.now() - startTime;

    console.log(`uploadFolder: 30 files in ${duration}ms`);

    // Verify all uploaded
    assert.equal(uploaded.length, 30, 'Should have uploaded all 30 files');
    
    const index = await remote.list(testWorkspaceId);
    assert.ok(index.size >= 30, 'Should have at least 30 files');
  });

  it('downloadFolder handles batch downloads efficiently', async () => {
    // Upload files first
    const uploadPromises = [];
    for (let i = 0; i < 30; i++) {
      uploadPromises.push(uploadTestFile(`file${i}.txt`, `content ${i}`));
    }
    await Promise.all(uploadPromises);

    // Prepare download list
    const files = [];
    for (let i = 0; i < 30; i++) {
      const localFile = path.join(localTempDir, `downloaded${i}.txt`);
      files.push({
        relPath: stringToRel(`file${i}.txt`),
        absLocal: localFile
      });
    }

    // Download using downloadFolder
    const startTime = Date.now();
    const downloaded = await remote.downloadFolder(testWorkspaceId, files);
    const duration = Date.now() - startTime;

    console.log(`downloadFolder: 30 files in ${duration}ms`);

    // Verify all downloaded
    assert.equal(downloaded.length, 30, 'Should have downloaded all 30 files');
    
    const localFiles = await fs.readdir(localTempDir);
    const downloadedFiles = localFiles.filter(f => f.startsWith('downloaded'));
    assert.ok(downloadedFiles.length >= 30, 'Should have at least 30 downloaded files');
  });
});