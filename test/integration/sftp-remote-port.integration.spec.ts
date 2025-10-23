import { strict as assert } from 'assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { SftpRemotePort } from '../../src/infrastructure/remote/SftpRemotePort';
import { WorkspaceConfigService } from '../../src/infrastructure/config/WorkspaceConfigService';
import { stringToWsId, stringToRel } from '../../src/infrastructure/helpers/path';
import type { WorkspaceId } from '../../src/domain/types';
import { WorkspaceConfigData } from '../../src/infrastructure/config/WorkspaceConfig';

/**
 * Phase 3: SftpRemotePort Integration Tests
 * 
 * These tests use a REAL SSH/SFTP connection to your VM at 192.168.1.17
 * 
 * Prerequisites:
 * - VM must be running at 192.168.1.17
 * - SSH accessible on port 22
 * - Credentials: centos/centos
 * - Remote path: /home/centos/test-workspace
 * 
 * WARNING: These tests will create/modify/delete files on the remote server!
 */

// Skip tests if VM is not available
const VM_CONFIG = {
  hostname: '192.168.1.17',
  port: 22,
  username: 'centos',
  password: 'centos',
  remotePath: '/home/centos/test-workspace'
};

// Set to false to skip tests when VM is not available
const RUN_INTEGRATION_TESTS = true;

const describeIntegration = RUN_INTEGRATION_TESTS ? describe : describe.skip;

describeIntegration('SftpRemotePort Integration Tests (Phase 3)', function() {
  // Increase timeout for network operations
  this.timeout(30000);

  let configService: WorkspaceConfigService;
  let sftpPort: SftpRemotePort;
  let testWorkspaceId: WorkspaceId;
  let tempLocalDir: string;

  before(async () => {
    // Create temp local directory for test files
    tempLocalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'livesync-test-'));
    
    // Create mock workspace folder
    testWorkspaceId = stringToWsId(tempLocalDir);
    
    // Create mock config service with ignore patterns for the ignore test
    const mockConfigData: WorkspaceConfigData = {
      hostname: VM_CONFIG.hostname,
      port: VM_CONFIG.port,
      username: VM_CONFIG.username,
      password: VM_CONFIG.password,
      remotePath: VM_CONFIG.remotePath,
      ignoreList: ['.vscode', '.git', '.livesync']  // Added for ignore test
    };
    
    // Mock config service
    configService = {
      getById: async () => ({
        data: mockConfigData,
        ignoreGlobs: ['**/.vscode/**', '**/.vscode', '**/.git/**', '**/.git', '**/.livesync/**', '**/.livesync'],  // Proper patterns
        hasRemote: true
      })
    } as any;
    
    sftpPort = new SftpRemotePort(configService, 2); // Reduced concurrency to 2
    
    // Clean up remote test directory before tests
    try {
      await cleanRemoteDirectory();
    } catch (err) {
      console.warn('Could not clean remote directory (may not exist yet):', err);
    }
  });

  after(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempLocalDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('Could not clean temp directory:', err);
    }
    
    // Clean up remote test files
    try {
      await cleanRemoteDirectory();
    } catch (err) {
      console.warn('Could not clean remote directory:', err);
    }
  });

  async function cleanRemoteDirectory() {
    // Use SSH to clean the test directory
    const { Client: SSHClient } = require('ssh2');
    const client = new SSHClient();
    
    return new Promise<void>((resolve, reject) => {
      client
        .on('ready', () => {
          client.exec(`rm -rf ${VM_CONFIG.remotePath}/* ${VM_CONFIG.remotePath}/.*`, (err: any, stream: any) => {
            if (err) {
              client.end();
              return reject(err);
            }
            
            stream.on('close', () => {
              client.end();
              resolve();
            });
            
            stream.on('data', () => {});
            stream.stderr.on('data', () => {});
          });
        })
        .on('error', reject)
        .connect({
          host: VM_CONFIG.hostname,
          port: VM_CONFIG.port,
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          readyTimeout: 10000
        });
    });
  }

  describe('Connection', () => {
    it('can connect to VM via SSH', async () => {
      // Just listing should establish connection
      const index = await sftpPort.list(testWorkspaceId);
      assert.ok(index);
      assert.ok(index instanceof Map);
    });
  });

  describe('list()', () => {
    it('returns empty index for empty remote directory', async () => {
      const index = await sftpPort.list(testWorkspaceId);
      
      assert.ok(index instanceof Map);
      // Should be empty or only contain root folder
      assert.ok(index.size <= 1);
    });

    it('lists files after upload', async () => {
      // Create a test file locally
      const testFile = path.join(tempLocalDir, 'test-list.txt');
      await fs.writeFile(testFile, 'test content for listing');
      
      // Upload it
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('test-list.txt'), testFile);
      
      // List remote
      const index = await sftpPort.list(testWorkspaceId);
      
      assert.ok(index.has(stringToRel('test-list.txt')));
      const entry = index.get(stringToRel('test-list.txt'))!;
      assert.equal(entry.type, 'file');
      assert.ok(entry.hash);
      assert.equal(entry.hash.length, 64); // SHA-256 hash
    });

    it('lists folders after creation', async () => {
      // Create a file in a subfolder
      const testFile = path.join(tempLocalDir, 'test-folder-list.txt');
      await fs.writeFile(testFile, 'content');
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('subfolder/test-folder-list.txt'), testFile);
      
      const index = await sftpPort.list(testWorkspaceId);
      
      // Should have folder entry
      assert.ok(index.has(stringToRel('subfolder')));
      const folderEntry = index.get(stringToRel('subfolder'))!;
      assert.equal(folderEntry.type, 'folder');
      assert.ok(folderEntry.hash);
      
      // Should have file entry
      assert.ok(index.has(stringToRel('subfolder/test-folder-list.txt')));
    });

    it('computes folder hashes correctly', async () => {
      // Upload multiple files to same folder
      const file1 = path.join(tempLocalDir, 'folder-hash-1.txt');
      const file2 = path.join(tempLocalDir, 'folder-hash-2.txt');
      
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('hashtest/file1.txt'), file1);
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('hashtest/file2.txt'), file2);
      
      const index = await sftpPort.list(testWorkspaceId);
      
      const folderEntry = index.get(stringToRel('hashtest'))!;
      assert.equal(folderEntry.type, 'folder');
      
      const hash1 = folderEntry.hash;
      assert.ok(hash1);
      
      // Upload same files again - hash should be same
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('hashtest/file1.txt'), file1);
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('hashtest/file2.txt'), file2);
      
      const index2 = await sftpPort.list(testWorkspaceId);
      const folderEntry2 = index2.get(stringToRel('hashtest'))!;
      
      assert.equal(folderEntry2.hash, hash1, 'Folder hash should be deterministic');
    });

    it('respects ignore patterns', async () => {
      // Upload a file that should be ignored
      const testFile = path.join(tempLocalDir, 'ignored.txt');
      await fs.writeFile(testFile, 'should be ignored');
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('.vscode/settings.json'), testFile);
      
      const index = await sftpPort.list(testWorkspaceId);
      
      // .vscode should be ignored by the list() operation
      assert.ok(!index.has(stringToRel('.vscode/settings.json')), 'File in .vscode should be ignored');
      assert.ok(!index.has(stringToRel('.vscode')), 'Folder .vscode should be ignored');
    });
  });

  describe('uploadFile()', () => {
    it('uploads a single file', async () => {
      const testFile = path.join(tempLocalDir, 'upload-single.txt');
      const content = 'Single upload test';
      await fs.writeFile(testFile, content);
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('single.txt'), testFile);
      
      const index = await sftpPort.list(testWorkspaceId);
      assert.ok(index.has(stringToRel('single.txt')));
    });

    it('creates parent directories automatically', async () => {
      const testFile = path.join(tempLocalDir, 'nested-upload.txt');
      await fs.writeFile(testFile, 'nested content');
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('deep/nested/path/file.txt'), testFile);
      
      const index = await sftpPort.list(testWorkspaceId);
      assert.ok(index.has(stringToRel('deep')));
      assert.ok(index.has(stringToRel('deep/nested')));
      assert.ok(index.has(stringToRel('deep/nested/path')));
      assert.ok(index.has(stringToRel('deep/nested/path/file.txt')));
    });

    it('overwrites existing files', async () => {
      const testFile = path.join(tempLocalDir, 'overwrite.txt');
      
      // Upload first time
      await fs.writeFile(testFile, 'version 1');
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('overwrite.txt'), testFile);
      
      const index1 = await sftpPort.list(testWorkspaceId);
      const hash1 = index1.get(stringToRel('overwrite.txt'))!.hash;
      
      // Upload second time with different content
      await fs.writeFile(testFile, 'version 2 - different');
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('overwrite.txt'), testFile);
      
      const index2 = await sftpPort.list(testWorkspaceId);
      const hash2 = index2.get(stringToRel('overwrite.txt'))!.hash;
      
      assert.notEqual(hash1, hash2, 'Hash should change after overwrite');
    });

    it('handles binary files', async () => {
      const testFile = path.join(tempLocalDir, 'binary.dat');
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      await fs.writeFile(testFile, binaryData);
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('binary.dat'), testFile);
      
      const index = await sftpPort.list(testWorkspaceId);
      assert.ok(index.has(stringToRel('binary.dat')));
    });
  });

  describe('downloadFile()', () => {
    it('downloads a file', async () => {
      // First upload a file
      const uploadFile = path.join(tempLocalDir, 'download-source.txt');
      const content = 'Download test content';
      await fs.writeFile(uploadFile, content);
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('download-test.txt'), uploadFile);
      
      // Now download it to a different location
      const downloadFile = path.join(tempLocalDir, 'downloaded.txt');
      await sftpPort.downloadFile(testWorkspaceId, stringToRel('download-test.txt'), downloadFile);
      
      // Verify content
      const downloadedContent = await fs.readFile(downloadFile, 'utf8');
      assert.equal(downloadedContent, content);
    });

    it('creates parent directories for download', async () => {
      // Upload
      const uploadFile = path.join(tempLocalDir, 'deep-dl-source.txt');
      await fs.writeFile(uploadFile, 'deep download');
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('deep-dl.txt'), uploadFile);
      
      // Download to nested path
      const downloadFile = path.join(tempLocalDir, 'download', 'nested', 'file.txt');
      await sftpPort.downloadFile(testWorkspaceId, stringToRel('deep-dl.txt'), downloadFile);
      
      const content = await fs.readFile(downloadFile, 'utf8');
      assert.equal(content, 'deep download');
    });

    it('throws error when file does not exist', async () => {
      const downloadFile = path.join(tempLocalDir, 'nonexistent-download.txt');
      
      await assert.rejects(
        async () => {
          await sftpPort.downloadFile(
            testWorkspaceId,
            stringToRel('does-not-exist.txt'),
            downloadFile
          );
        },
        /No such file/i
      );
    });
  });

  describe('deletePath()', () => {
    it('deletes a single file', async () => {
      // Upload
      const testFile = path.join(tempLocalDir, 'delete-me.txt');
      await fs.writeFile(testFile, 'delete this');
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('delete-me.txt'), testFile);
      
      // Verify exists
      let index = await sftpPort.list(testWorkspaceId);
      assert.ok(index.has(stringToRel('delete-me.txt')));
      
      // Delete
      await sftpPort.deletePath(testWorkspaceId, stringToRel('delete-me.txt'));
      
      // Verify deleted
      index = await sftpPort.list(testWorkspaceId);
      assert.ok(!index.has(stringToRel('delete-me.txt')));
    });

    it('deletes folder recursively', async () => {
      // Upload files to folder
      const file1 = path.join(tempLocalDir, 'f1.txt');
      const file2 = path.join(tempLocalDir, 'f2.txt');
      await fs.writeFile(file1, 'file 1');
      await fs.writeFile(file2, 'file 2');
      
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('delete-folder/file1.txt'), file1);
      await sftpPort.uploadFile(testWorkspaceId, stringToRel('delete-folder/sub/file2.txt'), file2);
      
      // Verify exists
      let index = await sftpPort.list(testWorkspaceId);
      assert.ok(index.has(stringToRel('delete-folder')));
      assert.ok(index.has(stringToRel('delete-folder/file1.txt')));
      assert.ok(index.has(stringToRel('delete-folder/sub/file2.txt')));
      
      // Delete folder
      await sftpPort.deletePath(testWorkspaceId, stringToRel('delete-folder'));
      
      // Verify deleted
      index = await sftpPort.list(testWorkspaceId);
      assert.ok(!index.has(stringToRel('delete-folder')));
      assert.ok(!index.has(stringToRel('delete-folder/file1.txt')));
      assert.ok(!index.has(stringToRel('delete-folder/sub/file2.txt')));
    });

    it('handles deleting non-existent path gracefully', async () => {
      // Should not throw
      await assert.doesNotReject(async () => {
        await sftpPort.deletePath(testWorkspaceId, stringToRel('does-not-exist.txt'));
      });
    });
  });

  describe('Performance', () => {
    it('handles uploading multiple files concurrently', async () => {
      const files = [];
      
      // Create 10 test files
      for (let i = 0; i < 10; i++) {
        const file = path.join(tempLocalDir, `perf-${i}.txt`);
        await fs.writeFile(file, `Performance test file ${i}`);
        files.push(file);
      }
      
      // Upload all concurrently
      const start = Date.now();
      await Promise.all(
        files.map((file, i) => 
          sftpPort.uploadFile(
            testWorkspaceId,
            stringToRel(`perf/file-${i}.txt`),
            file
          )
        )
      );
      const duration = Date.now() - start;
      
      console.log(`Uploaded 10 files in ${duration}ms`);
      
      // Verify all uploaded
      const index = await sftpPort.list(testWorkspaceId);
      for (let i = 0; i < 10; i++) {
        assert.ok(index.has(stringToRel(`perf/file-${i}.txt`)));
      }
    });

    it('list() is efficient for moderate file counts', async function() {
      // Now with connection pooling, this should work!
      this.timeout(60000);
      
      // Upload 50 files across different folders
      const uploads = [];
      for (let i = 0; i < 50; i++) {
        const file = path.join(tempLocalDir, `list-perf-${i}.txt`);
        await fs.writeFile(file, `Content ${i}`);
        
        const folder = `list-perf/folder${Math.floor(i / 10)}`;
        uploads.push(
          sftpPort.uploadFile(
            testWorkspaceId,
            stringToRel(`${folder}/file-${i}.txt`),
            file
          )
        );
      }
      
      // Upload with limited concurrency (2) to avoid overwhelming the server
      for (let i = 0; i < uploads.length; i += 2) {
        await Promise.all(uploads.slice(i, i + 2));
      }
      
      // Measure list performance
      const start = Date.now();
      const index = await sftpPort.list(testWorkspaceId);
      const duration = Date.now() - start;
      
      console.log(`Listed ${index.size} entries in ${duration}ms`);
      
      assert.ok(index.size >= 50, 'Should have at least 50 files');
      assert.ok(duration < 5000, 'Listing should complete in under 5 seconds');
    });
  });

  describe('Error Handling', () => {
    it('handles connection timeout gracefully', async function() {
      this.timeout(15000);
      
      // Create config with wrong hostname
      const badConfigService = {
        getById: async () => ({
          data: {
            hostname: '192.168.1.254', // Non-existent host
            port: 22,
            username: 'test',
            password: 'test',
            remotePath: '/tmp'
          },
          ignoreGlobs: [],
          hasRemote: true
        })
      } as any;
      
      const badSftp = new SftpRemotePort(badConfigService, 2);
      
      await assert.rejects(
        async () => {
          await badSftp.list(testWorkspaceId);
        },
        /timeout|ETIMEDOUT|ECONNREFUSED|Timed out/i
      );
    });

    it('handles authentication failure', async () => {
      const badConfigService = {
        getById: async () => ({
          data: {
            hostname: VM_CONFIG.hostname,
            port: VM_CONFIG.port,
            username: 'wronguser',
            password: 'wrongpass',
            remotePath: '/tmp'
          },
          ignoreGlobs: [],
          hasRemote: true
        })
      } as any;
      
      const badSftp = new SftpRemotePort(badConfigService, 2);
      
      await assert.rejects(
        async () => {
          await badSftp.list(testWorkspaceId);
        },
        /auth|permission/i
      );
    });
  });
});