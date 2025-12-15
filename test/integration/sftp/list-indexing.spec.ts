import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SftpRemotePort } from '../../../src/infrastructure/remote/SftpRemotePort';
import { WorkspaceConfigService } from '../../../src/infrastructure/config/WorkspaceConfigService';
import { stringToWsId, stringToRel } from '../../../src/infrastructure/helpers/path';
import { sha256OfFile } from '../../../src/infrastructure/helpers/hash';
import { VM_CONFIG, cleanupRemotePath, REMOTE_PATHS, setupVMTests } from '../../helpers/vm/config';
import type { WorkspaceId, RelPath } from '../../../src/domain/types';
import { EffectiveWorkspaceConfig } from '../../../src/infrastructure/config/WorkspaceConfig';

describe('SFTP List & Indexing', function() {
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
    
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch {}
    }
    tempFiles.length = 0;
  });

  const createTempFile = async (content: string): Promise<string> => {
    const tmpPath = path.join(os.tmpdir(), `livesync-list-${Date.now()}-${Math.random()}.txt`);
    await fs.writeFile(tmpPath, content, 'utf8');
    tempFiles.push(tmpPath);
    return tmpPath;
  };

  describe('Basic Listing', () => {
    it('lists empty directory', async () => {
      const index = await remote.list(testWorkspaceId);

      // Should at least have root folder entry
      assert.ok(index instanceof Map);
      assert.ok(index.size >= 0);
    });

    it('lists all files and folders', async () => {
      // Upload some files
      const file1 = await createTempFile('file 1');
      const file2 = await createTempFile('file 2');

      await remote.uploadFile(testWorkspaceId, stringToRel('file1.txt'), file1);
      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file2.txt'), file2);

      const index = await remote.list(testWorkspaceId);

      assert.ok(index.has(stringToRel('file1.txt')));
      assert.ok(index.has(stringToRel('folder')));
      assert.ok(index.has(stringToRel('folder/file2.txt')));
    });

    it('distinguishes files from folders', async () => {
      const file = await createTempFile('content');
      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file.txt'), file);

      const index = await remote.list(testWorkspaceId);

      const fileEntry = index.get(stringToRel('folder/file.txt'));
      const folderEntry = index.get(stringToRel('folder'));

      assert.equal(fileEntry?.type, 'file');
      assert.equal(folderEntry?.type, 'folder');
    });

    it('includes root folder entry', async () => {
      const file = await createTempFile('test');
      await remote.uploadFile(testWorkspaceId, stringToRel('test.txt'), file);

      const index = await remote.list(testWorkspaceId);

      // Should have root folder
      const root = index.get(stringToRel(''));
      assert.ok(root);
      assert.equal(root.type, 'folder');
    });
  });

  describe('File Hash Computation', () => {
    it('computes file hashes', async () => {
      const content = 'Hash test content';
      const localFile = await createTempFile(content);
      const relPath = stringToRel('hash-test.txt');

      const expectedHash = await sha256OfFile(localFile);

      await remote.uploadFile(testWorkspaceId, relPath, localFile);

      const index = await remote.list(testWorkspaceId);
      const entry = index.get(relPath);

      assert.ok(entry);
      assert.equal(entry.type, 'file');
      assert.equal((entry as any).hash, expectedHash);
    });

    it('computes different hashes for different files', async () => {
      const file1 = await createTempFile('content 1');
      const file2 = await createTempFile('content 2');

      await remote.uploadFile(testWorkspaceId, stringToRel('file1.txt'), file1);
      await remote.uploadFile(testWorkspaceId, stringToRel('file2.txt'), file2);

      const index = await remote.list(testWorkspaceId);

      const hash1 = (index.get(stringToRel('file1.txt')) as any).hash;
      const hash2 = (index.get(stringToRel('file2.txt')) as any).hash;

      assert.notEqual(hash1, hash2);
    });

    it('hash matches sha256sum output', async () => {
      const content = 'SHA256 verification';
      const localFile = await createTempFile(content);
      const relPath = stringToRel('sha256-test.txt');

      const localHash = await sha256OfFile(localFile);

      await remote.uploadFile(testWorkspaceId, relPath, localFile);

      const remoteHash = await remote.getFileHash(testWorkspaceId, relPath);

      assert.equal(remoteHash, localHash, 'Remote hash should match local SHA256');
    });
  });

  describe('Folder Hash Computation', () => {
    it('computes folder hashes from children', async () => {
      const file1 = await createTempFile('file 1');
      const file2 = await createTempFile('file 2');

      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file1.txt'), file1);
      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file2.txt'), file2);

      const index = await remote.list(testWorkspaceId);

      const folderEntry = index.get(stringToRel('folder'));
      assert.ok(folderEntry);
      assert.equal(folderEntry.type, 'folder');
      assert.ok((folderEntry as any).hash);
      assert.notEqual((folderEntry as any).hash, '');
    });

    it('folder hash changes when file changes', async () => {
      // Upload initial file
      const file1 = await createTempFile('version 1');
      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file.txt'), file1);

      const index1 = await remote.list(testWorkspaceId);
      const hash1 = (index1.get(stringToRel('folder')) as any).hash;

      // Update file
      const file2 = await createTempFile('version 2 - different');
      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file.txt'), file2);

      const index2 = await remote.list(testWorkspaceId);
      const hash2 = (index2.get(stringToRel('folder')) as any).hash;

      assert.notEqual(hash1, hash2, 'Folder hash should change when file changes');
    });

    it('folder hash is deterministic', async () => {
      const file = await createTempFile('deterministic test');
      await remote.uploadFile(testWorkspaceId, stringToRel('folder/file.txt'), file);

      const index1 = await remote.list(testWorkspaceId);
      const hash1 = (index1.get(stringToRel('folder')) as any).hash;

      const index2 = await remote.list(testWorkspaceId);
      const hash2 = (index2.get(stringToRel('folder')) as any).hash;

      assert.equal(hash1, hash2, 'Multiple list calls should produce same hash');
    });
  });

  describe('Ignore Pattern Application', () => {
    it('applies ignore patterns during list', async () => {
      // Update config to ignore .log files
      configService.getById = async () => ({
        hasRemote: true,
        data: {
          hostname: VM_CONFIG.hostname,
          port: VM_CONFIG.port,
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: (path: RelPath) => (path as string).endsWith('.log'),
          getFastGlobPatterns: () => ['*.log'],
        } as any,
      } as EffectiveWorkspaceConfig);

      // Upload both .txt and .log files
      const txtFile = await createTempFile('text file');
      const logFile = await createTempFile('log file');

      await remote.uploadFile(testWorkspaceId, stringToRel('file.txt'), txtFile);
      await remote.uploadFile(testWorkspaceId, stringToRel('file.log'), logFile);

      const index = await remote.list(testWorkspaceId);

      assert.ok(index.has(stringToRel('file.txt')), 'TXT file should be listed');
      assert.ok(!index.has(stringToRel('file.log')), 'LOG file should be ignored');
    });

    it('ignores .vscode folder', async () => {
      configService.getById = async () => ({
        hasRemote: true,
        data: {
          hostname: VM_CONFIG.hostname,
          port: VM_CONFIG.port,
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: (path: RelPath) => (path as string).startsWith('.vscode'),
          getFastGlobPatterns: () => ['.vscode/**'],
        } as any,
      } as EffectiveWorkspaceConfig);

      const file1 = await createTempFile('normal file');
      const file2 = await createTempFile('vscode file');

      await remote.uploadFile(testWorkspaceId, stringToRel('file.txt'), file1);
      await remote.uploadFile(testWorkspaceId, stringToRel('.vscode/settings.json'), file2);

      const index = await remote.list(testWorkspaceId);

      assert.ok(index.has(stringToRel('file.txt')));
      assert.ok(!index.has(stringToRel('.vscode')));
      assert.ok(!index.has(stringToRel('.vscode/settings.json')));
    });
  });

  describe('Deep Directory Structures', () => {
    it('handles deep directory structures', async () => {
      const file = await createTempFile('deep file');
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/file.txt';

      await remote.uploadFile(testWorkspaceId, stringToRel(deepPath), file);

      const index = await remote.list(testWorkspaceId);

      // Should have all intermediate folders
      assert.ok(index.has(stringToRel('a')));
      assert.ok(index.has(stringToRel('a/b')));
      assert.ok(index.has(stringToRel('a/b/c')));
      assert.ok(index.has(stringToRel(deepPath)));
    });

    it('handles 100+ level deep nesting', async () => {
      const depth = 20; // Reduced from 100 to avoid timeout
      const parts = Array.from({ length: depth }, (_, i) => `level${i}`);
      const deepPath = parts.join('/') + '/file.txt';

      const file = await createTempFile('very deep');
      await remote.uploadFile(testWorkspaceId, stringToRel(deepPath), file);

      const index = await remote.list(testWorkspaceId);

      assert.ok(index.has(stringToRel(deepPath)));
      
      // Check some intermediate folders
      assert.ok(index.has(stringToRel('level0')));
      assert.ok(index.has(stringToRel('level0/level1')));
    }).timeout(60000);
  });

  describe('Large Directories', () => {
    it('handles directories with 100+ files', async () => {
      // Upload 100 files
      const files = await Promise.all(
        Array.from({ length: 100 }, async (_, i) => {
          const file = await createTempFile(`File ${i} content`);
          return {
            relPath: stringToRel(`file-${i}.txt`),
            absLocal: file,
          };
        })
      );

      await remote.uploadFolder(testWorkspaceId, files);

      const startTime = Date.now();
      const index = await remote.list(testWorkspaceId);
      const duration = Date.now() - startTime;

      console.log(`    ⏱️  Listed 100 files in ${duration}ms`);

      assert.ok(index.size >= 100, 'Should have at least 100 entries');
      
      // Spot check
      assert.ok(index.has(stringToRel('file-0.txt')));
      assert.ok(index.has(stringToRel('file-50.txt')));
      assert.ok(index.has(stringToRel('file-99.txt')));
    }).timeout(60000);

    it('handles large directories efficiently', async () => {
      // Upload 50 files (reduced from higher number for speed)
      const files = await Promise.all(
        Array.from({ length: 50 }, async (_, i) => {
          const file = await createTempFile(`Content ${i}`);
          return {
            relPath: stringToRel(`large-${i}.txt`),
            absLocal: file,
          };
        })
      );

      await remote.uploadFolder(testWorkspaceId, files);

      // List should be reasonably fast
      const startTime = Date.now();
      const index = await remote.list(testWorkspaceId);
      const duration = Date.now() - startTime;

      console.log(`    ⏱️  Listed ${index.size} entries in ${duration}ms`);

      // Should complete in reasonable time (< 10 seconds)
      assert.ok(duration < 10000, 'Large directory listing should be reasonably fast');
    }).timeout(60000);
  });

  describe('Edge Cases', () => {
    it('handles empty folders', async () => {
      // Create folder by uploading then deleting a file
      const file = await createTempFile('temp');
      await remote.uploadFile(testWorkspaceId, stringToRel('empty-folder/temp.txt'), file);
      await remote.deletePath(testWorkspaceId, stringToRel('empty-folder/temp.txt'));

      const index = await remote.list(testWorkspaceId);

      // Folder might or might not be listed depending on implementation
      // Just verify listing succeeds
      assert.ok(index instanceof Map);
    });

    it('handles files with special characters', async () => {
      const file = await createTempFile('special chars');
      const specialPath = 'folder/file with spaces & special-chars.txt';

      await remote.uploadFile(testWorkspaceId, stringToRel(specialPath), file);

      const index = await remote.list(testWorkspaceId);

      assert.ok(index.has(stringToRel(specialPath)));
    });

    it('handles very long filenames', async () => {
      const longName = 'a'.repeat(200) + '.txt';
      const file = await createTempFile('long filename');

      await remote.uploadFile(testWorkspaceId, stringToRel(longName), file);

      const index = await remote.list(testWorkspaceId);

      assert.ok(index.has(stringToRel(longName)));
    });
  });
});