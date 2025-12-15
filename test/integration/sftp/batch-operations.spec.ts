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

describe('SFTP Batch Operations', function() {
  this.timeout(60000);

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
          remotePath: REMOTE_PATHS.batch,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      }),
    } as any;

    remote = new SftpRemotePort(configService, 4);
    
    try {
      await cleanupRemotePath(REMOTE_PATHS.batch);
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err instanceof Error ? err.message : 'unknown'}`);
      this.skip();
    }
  });

  afterEach(async () => {
    remote.dispose();
    
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch {}
    }
    tempFiles.length = 0;
  });

  const createTempFile = async (content: string): Promise<string> => {
    const tmpPath = path.join(os.tmpdir(), `livesync-batch-${Date.now()}-${Math.random()}.txt`);
    await fs.writeFile(tmpPath, content, 'utf8');
    tempFiles.push(tmpPath);
    return tmpPath;
  };

  describe('Batch Upload', () => {
    it('uploads 10 files concurrently', async () => {
      const files = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const localPath = await createTempFile(`File ${i} content`);
          return {
            relPath: stringToRel(`file-${i}.txt`),
            absLocal: localPath,
          };
        })
      );

      const startTime = Date.now();
      const uploaded = await remote.uploadFolder(testWorkspaceId, files);
      const duration = Date.now() - startTime;

      assert.equal(uploaded.length, 10, 'All files should be uploaded');
      console.log(`    ⏱️  Uploaded 10 files in ${duration}ms`);

      // Verify all files exist
      const index = await remote.list(testWorkspaceId);
      files.forEach(f => {
        assert.ok(index.has(f.relPath), `File ${f.relPath} should exist`);
      });
    });

    it('uploads 100 files concurrently', async () => {
      const files = await Promise.all(
        Array.from({ length: 100 }, async (_, i) => {
          const localPath = await createTempFile(`File ${i} content`);
          return {
            relPath: stringToRel(`batch-${i}.txt`),
            absLocal: localPath,
          };
        })
      );

      const startTime = Date.now();
      const uploaded = await remote.uploadFolder(testWorkspaceId, files);
      const duration = Date.now() - startTime;

      assert.equal(uploaded.length, 100, 'All files should be uploaded');
      console.log(`    ⏱️  Uploaded 100 files in ${duration}ms (${(duration/100).toFixed(1)}ms per file)`);

      // Spot check some files
      const index = await remote.list(testWorkspaceId);
      assert.ok(index.has(stringToRel('batch-0.txt')));
      assert.ok(index.has(stringToRel('batch-50.txt')));
      assert.ok(index.has(stringToRel('batch-99.txt')));
    });

    it('respects concurrency limit', async () => {
      // Create remote with low concurrency
      remote.dispose();
      remote = new SftpRemotePort(configService, 2); // Only 2 concurrent

      const files = await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          const localPath = await createTempFile(`Concurrent ${i}`);
          return {
            relPath: stringToRel(`concurrent-${i}.txt`),
            absLocal: localPath,
          };
        })
      );

      // Should complete without overwhelming the connection
      const uploaded = await remote.uploadFolder(testWorkspaceId, files);

      assert.equal(uploaded.length, 20);
    });

    it('handles mixed file sizes in batch', async () => {
      const files = await Promise.all([
        // Small file
        createTempFile('small').then(p => ({ relPath: stringToRel('small.txt'), absLocal: p })),
        // Medium file (100KB)
        createTempFile('x'.repeat(100 * 1024)).then(p => ({ relPath: stringToRel('medium.txt'), absLocal: p })),
        // Large file (1MB)
        createTempFile('y'.repeat(1024 * 1024)).then(p => ({ relPath: stringToRel('large.txt'), absLocal: p })),
      ]);

      const uploaded = await remote.uploadFolder(testWorkspaceId, files);

      assert.equal(uploaded.length, 3);
      
      const index = await remote.list(testWorkspaceId);
      assert.ok(index.has(stringToRel('small.txt')));
      assert.ok(index.has(stringToRel('medium.txt')));
      assert.ok(index.has(stringToRel('large.txt')));
    }).timeout(60000);

    it('continues on partial failures', async () => {
      const files = await Promise.all([
        createTempFile('good1').then(p => ({ relPath: stringToRel('good1.txt'), absLocal: p })),
        createTempFile('good2').then(p => ({ relPath: stringToRel('good2.txt'), absLocal: p })),
      ]);

      // Add a file that doesn't exist locally
      files.push({
        relPath: stringToRel('bad.txt'),
        absLocal: '/nonexistent/file.txt',
      });

      const uploaded = await remote.uploadFolder(testWorkspaceId, files);

      // Should upload the good files
      assert.ok(uploaded.length >= 2, 'Good files should still upload');
    });
  });

  describe('Batch Download', () => {
    it('downloads 10 files concurrently', async () => {
      // First upload 10 files
      const uploadFiles = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const localPath = await createTempFile(`Download test ${i}`);
          return {
            relPath: stringToRel(`dl-${i}.txt`),
            absLocal: localPath,
          };
        })
      );

      await remote.uploadFolder(testWorkspaceId, uploadFiles);

      // Now download them to new locations
      const downloadFiles = uploadFiles.map(f => ({
        relPath: f.relPath,
        absLocal: path.join(os.tmpdir(), `downloaded-${f.relPath}.txt`),
      }));

      downloadFiles.forEach(f => tempFiles.push(f.absLocal));

      const startTime = Date.now();
      const downloaded = await remote.downloadFolder(testWorkspaceId, downloadFiles);
      const duration = Date.now() - startTime;

      assert.equal(downloaded.length, 10, 'All files should be downloaded');
      console.log(`    ⏱️  Downloaded 10 files in ${duration}ms`);

      // Verify files exist locally
      for (const file of downloadFiles) {
        const exists = await fs.access(file.absLocal).then(() => true).catch(() => false);
        assert.ok(exists, `File should exist: ${file.absLocal}`);
      }
    });

    it('downloads 100 files concurrently', async () => {
      // Upload 100 files
      const uploadFiles = await Promise.all(
        Array.from({ length: 100 }, async (_, i) => {
          const localPath = await createTempFile(`Batch download ${i}`);
          return {
            relPath: stringToRel(`batch-dl-${i}.txt`),
            absLocal: localPath,
          };
        })
      );

      await remote.uploadFolder(testWorkspaceId, uploadFiles);

      // Download them
      const downloadFiles = uploadFiles.map((f, i) => ({
        relPath: f.relPath,
        absLocal: path.join(os.tmpdir(), `batch-downloaded-${i}.txt`),
      }));

      downloadFiles.forEach(f => tempFiles.push(f.absLocal));

      const startTime = Date.now();
      const downloaded = await remote.downloadFolder(testWorkspaceId, downloadFiles);
      const duration = Date.now() - startTime;

      assert.equal(downloaded.length, 100);
      console.log(`    ⏱️  Downloaded 100 files in ${duration}ms (${(duration/100).toFixed(1)}ms per file)`);
    });

    it('verifies downloaded file integrity', async () => {
      // Upload a file
      const content = 'Integrity check content';
      const uploadPath = await createTempFile(content);
      const relPath = stringToRel('integrity.txt');

      await remote.uploadFolder(testWorkspaceId, [{ relPath, absLocal: uploadPath }]);

      const originalHash = await sha256OfFile(uploadPath);

      // Download it
      const downloadPath = path.join(os.tmpdir(), `integrity-dl-${Date.now()}.txt`);
      tempFiles.push(downloadPath);

      await remote.downloadFolder(testWorkspaceId, [{ relPath, absLocal: downloadPath }]);

      const downloadedHash = await sha256OfFile(downloadPath);

      assert.equal(downloadedHash, originalHash, 'Downloaded file should match original');
    });
  });

  describe('Performance', () => {
    it('batch upload is faster than sequential', async () => {
      const files = await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          const localPath = await createTempFile(`Perf test ${i}`);
          return {
            relPath: stringToRel(`perf-${i}.txt`),
            absLocal: localPath,
          };
        })
      );

      // Batch upload
      const batchStart = Date.now();
      await remote.uploadFolder(testWorkspaceId, files);
      const batchDuration = Date.now() - batchStart;

      console.log(`    ⏱️  Batch upload: ${batchDuration}ms`);

      // Cleanup for sequential test
      try {
        await cleanupRemotePath(REMOTE_PATHS.batch);  // ← Note: .batch not .integration!
      } catch (err) {
        console.warn(`⚠️  Cleanup failed: ${err instanceof Error ? err.message : 'unknown'}`);
      }

      // Sequential upload
      const seqStart = Date.now();
      for (const file of files) {
        await remote.uploadFile(testWorkspaceId, file.relPath, file.absLocal);
      }
      const seqDuration = Date.now() - seqStart;

      console.log(`    ⏱️  Sequential upload: ${seqDuration}ms`);
      console.log(`    📈 Batch is ${(seqDuration / batchDuration).toFixed(2)}x faster`);

      // Batch should be at least 1.5x faster
      assert.ok(batchDuration < seqDuration / 1.5, 'Batch should be significantly faster');
    }).timeout(120000);
  });
});