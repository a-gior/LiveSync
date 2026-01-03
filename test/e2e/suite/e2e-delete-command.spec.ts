/**
 * E2E Tests - Delete Commands
 * Tests unified delete commands that detect what exists and prompt user
 * 
 * Test Structure:
 * 1. Delete File (Local Only) - 1 test
 * 2. Delete File (Remote Only) - 1 test
 * 3. Delete File (Both) - 1 test
 * 4. Delete Folder (Local Only) - 1 test
 * 5. Delete Folder (Remote Only) - 1 test
 * 6. Delete Folder (Both) - 1 test
 * 
 * Total: 6 tests
 * 
 * Note: In test mode, commands delete both sides if both exist.
 * In real usage, user is prompted to choose which side(s) to delete.
 */

import * as vscode from 'vscode';
import {
  setupE2ESuite,
  teardownE2ESuite,
  createAndOpenFile,
  cleanTestFile,
  assertFileStatus,
  assertRemoteExists,
  assertLocalExists,
  refresh,
  wait,
  type E2ETestContext,
  cleanAllTestFiles,
  createTestConfig
} from './e2e-shared-helpers';

suite('E2E - Delete Commands', function() {
  this.timeout(10000);

  let ctx: Partial<E2ETestContext> = {};
  
  const fileContent = 'Delete test content';

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
  // HELPER FUNCTIONS
  // ==========================================================================

  /**
   * Helper: Test file deletion behavior
   */
  async function testDeleteFileBehavior(
    testFileName: string,
    scenario: 'local-only' | 'remote-only' | 'both',
    shouldExistLocalAfter: boolean,
    shouldExistRemoteAfter: boolean
  ): Promise<void> {
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
    });
    await refresh();
    
    // Setup based on scenario
    if (scenario === 'local-only') {
      // Create file locally (don't upload)
      await createAndOpenFile(testFile, fileContent);
      await wait(1000);
      
      await refresh();
      await assertLocalExists(testFile, true, 'File should exist locally');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');
      
    } else if (scenario === 'remote-only') {
      // Create file on remote only
      await ctx.remoteVerifier!.createFile(testFileName, fileContent);
      await wait(1000);
      
      await refresh();
      await assertRemoteExists(ctx.remoteVerifier!, testFileName, true, 'File should exist remotely');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'removed');
      
    } else if (scenario === 'both') {
      // Create file locally and upload
      await createAndOpenFile(testFile, fileContent);
      await wait(1000);
      await vscode.commands.executeCommand('livesync.upload', testFile);
      await wait(2000);
      
      await refresh();
      await assertLocalExists(testFile, true, 'File should exist locally');
      await assertRemoteExists(ctx.remoteVerifier!, testFileName, true, 'File should exist remotely');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'unchanged');
    }
    
    // Execute delete command
    await vscode.commands.executeCommand('livesync.delete', testFile);
    await wait(2000);
    
    // Verify final state
    await assertLocalExists(testFile, shouldExistLocalAfter, 
      `File should ${shouldExistLocalAfter ? 'exist' : 'be deleted'} locally`);
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, shouldExistRemoteAfter,
      `File should ${shouldExistRemoteAfter ? 'exist' : 'be deleted'} remotely`);
  }

  /**
   * Helper: Test folder deletion behavior
   */
  async function testDeleteFolderBehavior(
    folderName: string,
    scenario: 'local-only' | 'remote-only' | 'both',
    shouldExistLocalAfter: boolean,
    shouldExistRemoteAfter: boolean
  ): Promise<void> {
    const folderUri = vscode.Uri.joinPath(ctx.testWorkspace!.uri, folderName);
    const file1 = vscode.Uri.joinPath(folderUri, 'file1.txt');
    const file2 = vscode.Uri.joinPath(folderUri, 'file2.txt');
    
    // Clean any existing test artifacts
    try {
      await vscode.workspace.fs.delete(folderUri, { recursive: true });
    } catch {}
    try {
      await ctx.remoteVerifier!.deleteFolder(folderName);
    } catch {}
    await wait(500);
    
    // Setup based on scenario
    if (scenario === 'local-only') {
      // Create folder with files locally (don't upload)
      await vscode.workspace.fs.createDirectory(folderUri);
      await vscode.workspace.fs.writeFile(file1, Buffer.from('content1'));
      await vscode.workspace.fs.writeFile(file2, Buffer.from('content2'));
      await wait(1000);
      
      await refresh();
      await assertLocalExists(file1, true, 'File1 should exist locally');
      await assertLocalExists(file2, true, 'File2 should exist locally');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, file1, 'added');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, file2, 'added');
      
    } else if (scenario === 'remote-only') {
      // Create folder with files on remote only
      await ctx.remoteVerifier!.createFile(`${folderName}/file1.txt`, 'content1');
      await ctx.remoteVerifier!.createFile(`${folderName}/file2.txt`, 'content2');
      await wait(1000);
      
      await refresh();
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, true, 'File1 should exist remotely');
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, true, 'File2 should exist remotely');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, file1, 'removed');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, file2, 'removed');
      
    } else if (scenario === 'both') {
      // Create folder with files locally and upload
      await vscode.workspace.fs.createDirectory(folderUri);
      await vscode.workspace.fs.writeFile(file1, Buffer.from('content1'));
      await vscode.workspace.fs.writeFile(file2, Buffer.from('content2'));
      await wait(1000);
      
      await vscode.commands.executeCommand('livesync.uploadFolder', folderUri);
      await wait(3000);
      
      await refresh();
      await assertLocalExists(file1, true, 'File1 should exist locally');
      await assertLocalExists(file2, true, 'File2 should exist locally');
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, true, 'File1 should exist remotely');
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, true, 'File2 should exist remotely');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, file1, 'unchanged');
      await assertFileStatus(ctx.services!, ctx.testWorkspace!, file2, 'unchanged');
    }
    
    // Execute delete folder command
    await vscode.commands.executeCommand('livesync.deleteFolder', folderUri);
    await wait(2000);
    
    // Verify final state
    if (!shouldExistLocalAfter) {
      await assertLocalExists(folderUri, false, 'Folder should be deleted locally');
      await assertLocalExists(file1, false, 'File1 should be deleted locally');
      await assertLocalExists(file2, false, 'File2 should be deleted locally');
    } else {
      await assertLocalExists(folderUri, true, 'Folder should exist locally');
      await assertLocalExists(file1, true, 'File1 should exist locally');
      await assertLocalExists(file2, true, 'File2 should exist locally');
    }
    
    if (!shouldExistRemoteAfter) {
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, false, 'File1 should be deleted remotely');
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, false, 'File2 should be deleted remotely');
    } else {
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, true, 'File1 should exist remotely');
      await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, true, 'File2 should exist remotely');
    }
  }

  // ==========================================================================
  // DELETE FILE TESTS
  // ==========================================================================

  test('Delete File (Local Only) - removes only local file', async () => {
    await testDeleteFileBehavior(
      'delete-local-only.txt',
      'local-only',
      false, // shouldExistLocalAfter
      false  // shouldExistRemoteAfter
    );
  });

  test('Delete File (Remote Only) - removes only remote file', async () => {
    await testDeleteFileBehavior(
      'delete-remote-only.txt',
      'remote-only',
      false, // shouldExistLocalAfter
      false  // shouldExistRemoteAfter
    );
  });

  test('Delete File (Both) - removes from both local and remote', async () => {
    await testDeleteFileBehavior(
      'delete-both.txt',
      'both',
      false, // shouldExistLocalAfter
      false  // shouldExistRemoteAfter
    );
  });

  // ==========================================================================
  // DELETE FOLDER TESTS
  // ==========================================================================

  test('Delete Folder (Local Only) - removes only local folder', async () => {
    await testDeleteFolderBehavior(
      'delete-folder-local-only',
      'local-only',
      false, // shouldExistLocalAfter
      false  // shouldExistRemoteAfter
    );
  });

  test('Delete Folder (Remote Only) - removes only remote folder', async () => {
    await testDeleteFolderBehavior(
      'delete-folder-remote-only',
      'remote-only',
      false, // shouldExistLocalAfter
      false  // shouldExistRemoteAfter
    );
  });

  test('Delete Folder (Both) - removes from both local and remote', async () => {
    await testDeleteFolderBehavior(
      'delete-folder-both',
      'both',
      false, // shouldExistLocalAfter
      false  // shouldExistRemoteAfter
    );
  });
});