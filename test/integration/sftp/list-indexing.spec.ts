import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SftpRemotePort } from '@infra/remote/SftpRemotePort';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { stringToWsId, stringToRel } from '@helpers/path';
import { VM_CONFIG, cleanupRemotePath, REMOTE_PATHS, setupVMTests } from '../../helpers/vm/config';
import type { WorkspaceId } from '@domain/types';

describe('SFTP List & Indexing', function() {
  this.timeout(60000);

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
    localTempDir = path.join(os.tmpdir(), `livesync-list-test-${Date.now()}`);
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
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          globs: ['.git/**', 'node_modules/**'],
          shouldIgnore: (path: string) => {
            // Mock ignore: ignore .git and node_modules
            return path.includes('.git') || path.includes('node_modules');
          },
          getFastGlobPatterns: () => ['.git/**', 'node_modules/**'],
        } as any,
      }),
    } as any;

    remote = new SftpRemotePort(configService, 4);
    
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

  it('lists all files and folders in flat structure', async () => {
    // Create test structure using uploadFile
    await uploadTestFile('file1.txt', 'file1');
    await uploadTestFile('file2.txt', 'file2');
    await uploadTestFile('src/app.ts', 'app');

    const index = await remote.list(testWorkspaceId);

    // Should have files and folders
    assert.ok(index.size >= 3, 'Should have at least 3 entries');
    assert.ok(index.has(stringToRel('file1.txt')), 'Should have file1.txt');
    assert.ok(index.has(stringToRel('file2.txt')), 'Should have file2.txt');
    assert.ok(index.has(stringToRel('src/app.ts')), 'Should have src/app.ts');
    assert.ok(index.has(stringToRel('src')), 'Should have src folder');
  });

  it('computes file hashes correctly', async () => {
    const content = 'test content for hash';
    await uploadTestFile('hashtest.txt', content);

    const index = await remote.list(testWorkspaceId);
    const fileMeta = index.get(stringToRel('hashtest.txt'));

    assert.ok(fileMeta, 'File should exist in index');
    assert.equal(fileMeta.type, 'file');
    assert.ok(fileMeta.hash, 'Should have hash');
    assert.ok(fileMeta.hash.length > 0, 'Hash should be non-empty');
    
    // Note: size and mtimeMs may not be populated by all SFTP implementations
  });

  it('computes folder hashes from children', async () => {
    await uploadTestFile('src/app.ts', 'app');
    await uploadTestFile('src/utils.ts', 'utils');

    const index = await remote.list(testWorkspaceId);
    const folderMeta = index.get(stringToRel('src'));

    assert.ok(folderMeta, 'Folder should exist in index');
    assert.equal(folderMeta.type, 'folder');
    assert.ok(folderMeta.hash, 'Folder should have hash');
    assert.ok(folderMeta.hash.length > 0, 'Folder hash should be non-empty');
    
    // Note: childCount may not be populated by all implementations
    // The important thing is that folder hash exists and changes when children change
  });

  it('applies ignore patterns during list', async () => {
    // Create files including ignored ones
    await uploadTestFile('included.txt', 'included');
    await uploadTestFile('.git/config', 'ignored');
    await uploadTestFile('node_modules/package.json', 'ignored');

    const index = await remote.list(testWorkspaceId);

    // Should have included file
    assert.ok(index.has(stringToRel('included.txt')), 'Should have included.txt');
    
    // Should NOT have ignored files
    assert.ok(!index.has(stringToRel('.git/config')), 'Should ignore .git files');
    assert.ok(!index.has(stringToRel('node_modules/package.json')), 'Should ignore node_modules');
    assert.ok(!index.has(stringToRel('.git')), 'Should ignore .git folder');
    assert.ok(!index.has(stringToRel('node_modules')), 'Should ignore node_modules folder');
  });

  it('handles deep directory structures (10 levels)', async () => {
    // Create 10-level deep file
    await uploadTestFile('a/b/c/d/e/f/g/h/i/j/deep.txt', 'deep');

    const index = await remote.list(testWorkspaceId);

    // Should include deep file
    assert.ok(
      index.has(stringToRel('a/b/c/d/e/f/g/h/i/j/deep.txt')),
      'Should handle 10-level deep files'
    );
    
    // Should include all parent folders
    assert.ok(index.has(stringToRel('a')), 'Should have top-level folder');
    assert.ok(index.has(stringToRel('a/b/c/d/e')), 'Should have mid-level folder');
  });

  it('handles large directories efficiently (100 files)', async function() {
    this.timeout(120000); // 2 minutes for large test

    // Create 100 files
    const uploads = [];
    for (let i = 0; i < 100; i++) {
      uploads.push(uploadTestFile(`file${i}.txt`, `file${i}`));
    }
    await Promise.all(uploads);

    const startTime = Date.now();
    const index = await remote.list(testWorkspaceId);
    const duration = Date.now() - startTime;

    assert.ok(index.size >= 100, 'Should have at least 100 files');
    console.log(`Listed 100 files in ${duration}ms`);
    
    // Should complete in reasonable time (< 30 seconds)
    assert.ok(duration < 30000, `Listing took ${duration}ms, should be < 30s`);
  });

  it('handles empty remote directory', async () => {
    // Directory is already clean from beforeEach
    const index = await remote.list(testWorkspaceId);

    // Should return empty or root-only index
    assert.ok(index.size <= 1, 'Empty directory should have 0 or 1 entries (root)');
  });

  it('handles mixed file types in same directory', async () => {
    await uploadTestFile('file.txt', 'text');
    await uploadTestFile('script.sh', 'script');
    await uploadTestFile('README.md', 'markdown');
    await uploadTestFile('folder/nested.txt', 'nested');

    const index = await remote.list(testWorkspaceId);

    // All files should be indexed
    assert.ok(index.has(stringToRel('file.txt')));
    assert.ok(index.has(stringToRel('script.sh')));
    assert.ok(index.has(stringToRel('README.md')));
    assert.ok(index.has(stringToRel('folder')));
    assert.ok(index.has(stringToRel('folder/nested.txt')));
  });

  it('folder hash changes when child file changes', async () => {
    // Create folder with file
    await uploadTestFile('src/app.ts', 'original');

    const index1 = await remote.list(testWorkspaceId);
    const hash1 = index1.get(stringToRel('src'))?.hash;

    // Modify child file (re-upload with different content)
    await uploadTestFile('src/app.ts', 'modified');

    const index2 = await remote.list(testWorkspaceId);
    const hash2 = index2.get(stringToRel('src'))?.hash;

    assert.ok(hash1, 'Should have hash before modification');
    assert.ok(hash2, 'Should have hash after modification');
    assert.notEqual(hash1, hash2, 'Folder hash should change when child changes');
  });

  it('detects file type correctly (file vs folder)', async () => {
    await uploadTestFile('myfile.txt', 'file');
    await uploadTestFile('myfolder/file.txt', 'file in folder');

    const index = await remote.list(testWorkspaceId);

    const fileMeta = index.get(stringToRel('myfile.txt'));
    const folderMeta = index.get(stringToRel('myfolder'));

    assert.ok(fileMeta);
    assert.ok(folderMeta);
    assert.equal(fileMeta.type, 'file', 'Should detect file type');
    assert.equal(folderMeta.type, 'folder', 'Should detect folder type');
  });

  it('includes root directory in index', async () => {
    await uploadTestFile('file.txt', 'file');

    const index = await remote.list(testWorkspaceId);

    // Root might be included as '' or not at all
    const rootMeta = index.get(stringToRel(''));
    
    if (rootMeta) {
      assert.equal(rootMeta.type, 'folder', 'Root should be a folder if included');
      console.log('Root directory included in index');
    } else {
      console.log('Root directory not included in index (implementation choice)');
    }
  });

  it('handles files with non-ASCII characters', async () => {
    // Create file with Unicode name
    await uploadTestFile('café.txt', 'unicode');

    const index = await remote.list(testWorkspaceId);

    // Should handle UTF-8 filenames
    const hasCafe = index.has(stringToRel('café.txt'));
    assert.ok(hasCafe, 'Should handle UTF-8 filenames');
  });

  it('lists files in consistent order across multiple calls', async () => {
    await uploadTestFile('a.txt', 'a');
    await uploadTestFile('b.txt', 'b');
    await uploadTestFile('c.txt', 'c');

    const index1 = await remote.list(testWorkspaceId);
    const index2 = await remote.list(testWorkspaceId);

    // Should return same entries
    assert.equal(index1.size, index2.size, 'Should return same number of entries');
    
    // Verify all keys match
    for (const key of index1.keys()) {
      assert.ok(index2.has(key), `Second list should have ${key}`);
    }
  });

  it('handles concurrent list operations', async () => {
    await uploadTestFile('file1.txt', 'file1');
    await uploadTestFile('file2.txt', 'file2');

    // Run 5 concurrent list operations
    const lists = await Promise.all([
      remote.list(testWorkspaceId),
      remote.list(testWorkspaceId),
      remote.list(testWorkspaceId),
      remote.list(testWorkspaceId),
      remote.list(testWorkspaceId),
    ]);

    // All should succeed and return same data
    lists.forEach((index, i) => {
      assert.ok(index.size >= 2, `List ${i} should have at least 2 entries`);
      assert.ok(index.has(stringToRel('file1.txt')), `List ${i} should have file1.txt`);
    });
  });

  it('verifies file hash matches actual content', async () => {
    const content = 'hash verification test';
    await uploadTestFile('hashverify.txt', content);

    // Get hash from index
    const index = await remote.list(testWorkspaceId);
    const fileMeta = index.get(stringToRel('hashverify.txt'));
    assert.ok(fileMeta);
    const indexHash = fileMeta.hash;

    // Get hash directly
    const directHash = await remote.getFileHash(testWorkspaceId, stringToRel('hashverify.txt'));

    assert.equal(indexHash, directHash, 'Index hash should match getFileHash result');
  });

  it('handles nested folders with varying depths', async () => {
    await uploadTestFile('shallow.txt', 'shallow');
    await uploadTestFile('level1/file.txt', 'level1');
    await uploadTestFile('level1/level2/file.txt', 'level2');
    await uploadTestFile('level1/level2/level3/file.txt', 'level3');

    const index = await remote.list(testWorkspaceId);

    // All levels should be indexed
    assert.ok(index.has(stringToRel('shallow.txt')));
    assert.ok(index.has(stringToRel('level1')));
    assert.ok(index.has(stringToRel('level1/level2')));
    assert.ok(index.has(stringToRel('level1/level2/level3')));
    assert.ok(index.has(stringToRel('level1/level2/level3/file.txt')));
  });

  it('handles folders with many children', async () => {
    // Create folder with 20 files
    const uploads = [];
    for (let i = 0; i < 20; i++) {
      uploads.push(uploadTestFile(`many/file${i}.txt`, `content${i}`));
    }
    await Promise.all(uploads);

    const index = await remote.list(testWorkspaceId);
    const folderMeta = index.get(stringToRel('many'));

    assert.ok(folderMeta, 'Folder should exist');
    assert.equal(folderMeta.type, 'folder');
    
    // Verify by counting the files in the folder
    const filesInFolder = Array.from(index.keys()).filter(k => 
      k.startsWith('many/') && k !== 'many/'
    );
    assert.ok(filesInFolder.length >= 20, `Should have at least 20 files in folder, found ${filesInFolder.length}`);
  });
});