/**
 * E2E Tests - Download Command
 * Tests download command with various policies and scenarios
 * 
 * Test Structure:
 * 1. Download File - 4 tests (none, download, check, check&download)
 * 2. Download Folder - 4 tests (none, download, check, check&download)
 * 3. Download File with Conflict - 3 tests (proceed, cancel, ignore)
 * 
 * Total: 11 tests
 * 
 * Note: Folder commands intentionally skip conflict detection (by design).
 * They are batch operations where user confirms after seeing diff tree.
 */

import * as vscode from 'vscode';
import {
  setupE2ESuite,
  teardownE2ESuite,
  createTestConfig,
  cleanTestFile,
  assertFileStatus,
  assertRemoteExists,
  assertRemoteContent,
  assertLocalContent,
  assertConflictIgnored,
  setTestResponse,
  refresh,
  wait,
  type E2ETestContext,
  cleanAllTestFiles
} from './e2e-shared-helpers';

suite('E2E - Download Command', function() {
  this.timeout(10000);

  let ctx: Partial<E2ETestContext> = {};
  
  const fileContent = 'File content for test';
  const conflictContent = 'Conflict content';
  const localContent = 'Local content';

  suiteSetup(async () => {
    const setup = await setupE2ESuite();
    Object.assign(ctx, setup);
    
    await cleanAllTestFiles(ctx.remoteVerifier!);
  });

  suiteTeardown(async () => {
    await teardownE2ESuite(ctx.remoteVerifier!, ctx.configPath);
  });

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);
  });

  // ==========================================================================
  // DOWNLOAD FILE TESTS
  // ==========================================================================

  /**
   * Test helper: Download file with specified policy
   */
  async function testDownloadFile(
    testFileName: string,
    policy: string,
    shouldExistLocallyAfter: boolean,
    expectedStatusAfter: 'removed' | 'unchanged'
  ): Promise<void> {
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnDownload: policy
    });
    
    // Create file on remote
    await ctx.remoteVerifier!.createFile(testFileName, fileContent);
    await refresh();
    await wait(500);
    
    // Verify initial state: file missing locally
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'removed');
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, true);
    
    // Execute download command
    await vscode.commands.executeCommand('livesync.download', testFile);
    await wait(1000);
    
    // Verify post-download state
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, expectedStatusAfter);
    
    if (shouldExistLocallyAfter) {
      await assertLocalContent(testFile, fileContent);
    } else {
      // Verify file doesn't exist locally
      try {
        await vscode.workspace.fs.stat(testFile);
        throw new Error('File should not exist locally');
      } catch (err: any) {
        if (err.message === 'File should not exist locally') {
          throw err;
        }
        // Expected: file not found
      }
    }
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
  }

  test('Download File with actionOnDownload=none - no download occurs', async () => {
    await testDownloadFile('download-file-none.txt', 'none', false, 'removed');
  });

  test('Download File with actionOnDownload=download - direct download without check', async () => {
    await testDownloadFile('download-file-download.txt', 'download', true, 'unchanged');
  });

  test('Download File with actionOnDownload=check - no download when check passes', async () => {
    await testDownloadFile('download-file-check.txt', 'check', false, 'removed');
  });

  test('Download File with actionOnDownload=check&download - download when no conflict', async () => {
    await testDownloadFile('download-file-check-download.txt', 'check&download', true, 'unchanged');
  });

  // ==========================================================================
  // DOWNLOAD FOLDER TESTS
  // ==========================================================================

  /**
   * Test helper: Download folder with specified policy
   */
  async function testDownloadFolder(
    folderName: string,
    policy: string,
    shouldExistLocallyAfter: boolean
  ): Promise<void> {
    const testFolder = vscode.Uri.joinPath(ctx.testWorkspace!.uri, folderName);
    const testFile1 = vscode.Uri.joinPath(testFolder, 'file1.txt');
    const testFile2 = vscode.Uri.joinPath(testFolder, 'file2.txt');
    
    // Clean folder (BEFORE test)
    try {
      await vscode.workspace.fs.delete(testFolder, { recursive: true });
    } catch {}
    try {
      await ctx.remoteVerifier!.deleteFolder(folderName);
    } catch {}
    await wait(1000);
    
    await refresh();
    await wait(500);
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnDownload: policy
    });
    
    // Create folder with files on remote
    await ctx.remoteVerifier!.createFile(`${folderName}/file1.txt`, fileContent);
    await ctx.remoteVerifier!.createFile(`${folderName}/file2.txt`, fileContent);
    await refresh();
    await wait(500);
    
    // Verify initial state - files missing locally
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile1, 'removed');
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile2, 'removed');
    
    // Execute download command on folder
    await vscode.commands.executeCommand('livesync.downloadFolder', testFolder);
    await wait(3000);
    
    // Verify post-download state
    if (shouldExistLocallyAfter) {
      await assertLocalContent(testFile1, fileContent);
      await assertLocalContent(testFile2, fileContent);
      assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile1, 'unchanged');
      assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile2, 'unchanged');
    } else {
      // Verify files don't exist locally
      assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile1, 'removed');
      assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile2, 'removed');
    }
    
    // Clean folder (AFTER test)
    try {
      await vscode.workspace.fs.delete(testFolder, { recursive: true });
    } catch {}
    try {
      await ctx.remoteVerifier!.deleteFolder(folderName);
    } catch {}
    await wait(500);
  }

  test('Download Folder with actionOnDownload=none - no download occurs', async () => {
    await testDownloadFolder('download-folder-none', 'none', false);
  });

  test('Download Folder with actionOnDownload=download - direct download without check', async () => {
    await testDownloadFolder('download-folder-download', 'download', true);
  });

  test('Download Folder with actionOnDownload=check - no download when check passes', async () => {
    await testDownloadFolder('download-folder-check', 'check', false);
  });

  test('Download Folder with actionOnDownload=check&download - download when no conflict', async () => {
    await testDownloadFolder('download-folder-check-download', 'check&download', true);
  });

  // ==========================================================================
  // DOWNLOAD FILE CONFLICT TESTS
  // ==========================================================================

  /**
   * Test helper: Download file with conflict
   */
  async function testDownloadFileConflict(
    testFileName: string,
    userResponse: 'proceed' | 'cancel' | 'ignore',
    expectedLocalContentAfter: string,
    shouldBeIgnored: boolean
  ): Promise<void> {
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnDownload: 'check&download'
    });
    
    // Set test response before triggering conflict
    await setTestResponse(userResponse);
    
    // Step 1: Create file locally first (conflict scenario)
    await vscode.workspace.fs.writeFile(testFile, Buffer.from(localContent));
    await wait(500);
    
    // Step 2: Create file on remote with different content
    await ctx.remoteVerifier!.createFile(testFileName, conflictContent);
    await refresh();
    await wait(500);
    
    // Step 3: Execute download command (should detect conflict)
    await vscode.commands.executeCommand('livesync.download', testFile);
    await wait(1000);
    
    // Step 4: Verify outcome based on user response
    await assertLocalContent(testFile, expectedLocalContentAfter);
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, conflictContent);
    
    if (shouldBeIgnored) {
      assertConflictIgnored(ctx.services!, ctx.testWorkspace!, testFile, true);
    }
    
    // Clear test response and cleanup
    await setTestResponse(null);
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
  }

  test('Download File Conflict - user clicks Proceed', async () => {
    await testDownloadFileConflict('download-conflict-proceed.txt', 'proceed', conflictContent, false);
  });

  test('Download File Conflict - user clicks Cancel', async () => {
    await testDownloadFileConflict('download-conflict-cancel.txt', 'cancel', localContent, false);
  });

  test('Download File Conflict - user clicks Ignore', async () => {
    await testDownloadFileConflict('download-conflict-ignore.txt', 'ignore', localContent, true);
  });
});