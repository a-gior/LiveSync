/**
 * E2E Tests - Upload Command
 * Tests upload command with various policies and scenarios
 * 
 * Test Structure:
 * 1. Upload File - 4 tests (none, upload, check, check&upload)
 * 2. Upload Folder - 4 tests (none, upload, check, check&upload)
 * 3. Upload File with Conflict - 3 tests (proceed, cancel, ignore)
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
  createAndOpenFile,
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

suite('E2E - Upload Command', function() {
  this.timeout(10000);

  let ctx: Partial<E2ETestContext> = {};
  
  const fileContent = 'File content for test';
  const conflictContent = 'Conflict content';
  const modifiedContent = 'Modified content';

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
  // UPLOAD FILE TESTS
  // ==========================================================================

  /**
   * Test helper: Upload file with specified policy
   */
  async function testUploadFile(
    testFileName: string,
    policy: string,
    shouldExistRemotelyAfter: boolean,
    expectedStatusAfter: 'added' | 'unchanged'
  ): Promise<void> {
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnUpload: policy
    });
    
    // Create file locally
    await createAndOpenFile(testFile, fileContent);
    await wait(500);
    
    // Verify initial state: file added locally
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, false);
    
    // Execute upload command
    await vscode.commands.executeCommand('livesync.upload', testFile);
    await wait(1000);
    
    // Verify post-upload state
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, expectedStatusAfter);
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, shouldExistRemotelyAfter);
    
    if (shouldExistRemotelyAfter) {
      await assertRemoteContent(ctx.remoteVerifier!, testFileName, fileContent);
    }
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
  }

  test('Upload File with actionOnUpload=none - no upload occurs', async () => {
    await testUploadFile('upload-file-none.txt', 'none', false, 'added');
  });

  test('Upload File with actionOnUpload=upload - direct upload without check', async () => {
    await testUploadFile('upload-file-upload.txt', 'upload', true, 'unchanged');
  });

  test('Upload File with actionOnUpload=check - no upload when check passes', async () => {
    await testUploadFile('upload-file-check.txt', 'check', false, 'added');
  });

  test('Upload File with actionOnUpload=check&upload - upload when no conflict', async () => {
    await testUploadFile('upload-file-check-upload.txt', 'check&upload', true, 'unchanged');
  });

  // ==========================================================================
  // UPLOAD FOLDER TESTS
  // ==========================================================================

  /**
   * Test helper: Upload folder with specified policy
   */
  async function testUploadFolder(
    folderName: string,
    policy: string,
    shouldExistRemotelyAfter: boolean
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
    await wait(500);
    
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnUpload: policy
    });
    
    // Create folder with files locally
    await vscode.workspace.fs.createDirectory(testFolder);
    await vscode.workspace.fs.writeFile(testFile1, Buffer.from(fileContent));
    await vscode.workspace.fs.writeFile(testFile2, Buffer.from(fileContent));
    await wait(500);
    
    // Verify initial state
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, false);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, false);
    
    // Execute upload command on folder
    await vscode.commands.executeCommand('livesync.uploadFolder', testFolder);
    await wait(2000);
    
    // Verify post-upload state
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, shouldExistRemotelyAfter);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, shouldExistRemotelyAfter);
    
    if (shouldExistRemotelyAfter) {
      await assertRemoteContent(ctx.remoteVerifier!, `${folderName}/file1.txt`, fileContent);
      await assertRemoteContent(ctx.remoteVerifier!, `${folderName}/file2.txt`, fileContent);
    }
    
    // Clean folder (AFTER test)
    try {
      await vscode.workspace.fs.delete(testFolder, { recursive: true });
    } catch {}
    try {
      await ctx.remoteVerifier!.deleteFolder(folderName);
    } catch {}
  }

  test('Upload Folder with actionOnUpload=none - no upload occurs', async () => {
    await testUploadFolder('folder-upload-none', 'none', false);
  });

  test('Upload Folder with actionOnUpload=upload - direct upload without check', async () => {
    await testUploadFolder('folder-upload-upload', 'upload', true);
  });

  test('Upload Folder with actionOnUpload=check - no upload when check passes', async () => {
    await testUploadFolder('folder-upload-check', 'check', false);
  });

  test('Upload Folder with actionOnUpload=check&upload - upload when no conflict', async () => {
    await testUploadFolder('folder-upload-check-upload', 'check&upload', true);
  });

  // ==========================================================================
  // UPLOAD FILE CONFLICT TESTS
  // ==========================================================================

  /**
   * Test helper: Upload file with conflict
   */
  async function testUploadFileConflict(
    testFileName: string,
    userResponse: 'proceed' | 'cancel' | 'ignore',
    expectedRemoteContentAfter: string,
    shouldBeIgnored: boolean
  ): Promise<void> {
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnUpload: 'check&upload'
    });
    
    // Set test response before triggering conflict
    await setTestResponse(userResponse);
    
    // Step 1: Create file on remote first (conflict scenario)
    await ctx.remoteVerifier!.createFile(testFileName, conflictContent);
    await refresh();
    
    // Step 2: Create file locally with different content
    await createAndOpenFile(testFile, modifiedContent);
    await wait(500);
    
    // Step 3: Execute upload command (should detect conflict)
    await vscode.commands.executeCommand('livesync.upload', testFile);
    await wait(1000);
    
    // Step 4: Verify outcome based on user response
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, expectedRemoteContentAfter);
    await assertLocalContent(testFile, modifiedContent);
    
    if (shouldBeIgnored) {
      assertConflictIgnored(ctx.services!, ctx.testWorkspace!, testFile, true);
    }
    
    // Clear test response and cleanup
    await setTestResponse(null);
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
  }

  test('Upload File Conflict - user clicks Proceed', async () => {
    await testUploadFileConflict('upload-conflict-proceed.txt', 'proceed', modifiedContent, false);
  });

  test('Upload File Conflict - user clicks Cancel', async () => {
    await testUploadFileConflict('upload-conflict-cancel.txt', 'cancel', conflictContent, false);
  });

  test('Upload File Conflict - user clicks Ignore', async () => {
    await testUploadFileConflict('upload-conflict-ignore.txt', 'ignore', conflictContent, true);
  });
});