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
  cleanAllTestFiles
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
  // DELETE FILE TESTS
  // ==========================================================================

  test('Delete File (Local Only) - removes only local file', async () => {
    const testFileName = 'delete-local-only.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    // Create file locally (don't upload)
    await createAndOpenFile(testFile, fileContent);
    await wait(1000);
    
    // Verify initial state - file exists locally only
    await refresh();
    await assertLocalExists(testFile, true, `File should exist locally`);
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');
    
    // Execute delete command
    await vscode.commands.executeCommand('livesync.delete', testFile);
    await wait(2000);
    
    // Verify file deleted locally
    await assertLocalExists(testFile, false, `File should be deleted locally`);
  });

  test('Delete File (Remote Only) - removes only remote file', async () => {
    const testFileName = 'delete-remote-only.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    // Create file on remote only
    await ctx.remoteVerifier!.createFile(testFileName, fileContent);
    await wait(1000);
    
    // Verify initial state - file exists remotely only
    await refresh();
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, true, `File should exist remotely`);
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'removed');
    
    // Execute delete command
    await vscode.commands.executeCommand('livesync.delete', testFile);
    await wait(2000);
    
    // Verify file deleted remotely
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, false, `File should be deleted remotely`);
  });

  test('Delete File (Both) - removes from both local and remote', async () => {
    const testFileName = 'delete-both.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    // Create file locally and upload
    await createAndOpenFile(testFile, fileContent);
    await wait(1000);
    await vscode.commands.executeCommand('livesync.upload', testFile);
    await wait(2000);
    
    // Verify initial state - file exists both locally and remotely
    await refresh();
    await assertLocalExists(testFile, true, `File should exist locally`);
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, true, `File should exist remotely`);
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'unchanged');
    
    // Execute delete command (in test mode, deletes both)
    await vscode.commands.executeCommand('livesync.delete', testFile);
    await wait(2000);
    
    // Verify file deleted from both sides
    await assertLocalExists(testFile, false, `File should be deleted locally`);
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, false, `File should be deleted remotely`);
  });

  // ==========================================================================
  // DELETE FOLDER TESTS
  // ==========================================================================

  test('Delete Folder (Local Only) - removes only local folder', async () => {
    const folderName = 'delete-folder-local-only';
    const folderUri = vscode.Uri.joinPath(ctx.testWorkspace!.uri, folderName);
    
    // Clean any existing test artifacts
    try {
      await vscode.workspace.fs.delete(folderUri, { recursive: true });
    } catch {}
    try {
      await ctx.remoteVerifier!.deleteFolder(folderName);
    } catch {}
    await wait(500);
    
    // Create folder with files locally (don't upload)
    await vscode.workspace.fs.createDirectory(folderUri);
    const file1 = vscode.Uri.joinPath(folderUri, 'file1.txt');
    const file2 = vscode.Uri.joinPath(folderUri, 'file2.txt');
    await vscode.workspace.fs.writeFile(file1, Buffer.from('content1'));
    await vscode.workspace.fs.writeFile(file2, Buffer.from('content2'));
    await wait(1000);
    
    // Verify initial state
    await refresh();
    await assertLocalExists(file1, true, `File1 should exist locally`);
    await assertLocalExists(file2, true, `File2 should exist locally`);
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, file1, 'added');
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, file2, 'added');
    
    // Execute delete folder command
    await vscode.commands.executeCommand('livesync.deleteFolder', folderUri);
    await wait(2000);
    
    // Verify folder and files deleted locally
    await assertLocalExists(folderUri, false, `Folder should be deleted locally`);
    await assertLocalExists(file1, false, `File1 should be deleted locally`);
    await assertLocalExists(file2, false, `File2 should be deleted locally`);
  });

  test('Delete Folder (Remote Only) - removes only remote folder', async () => {
    const folderName = 'delete-folder-remote-only';
    const folderUri = vscode.Uri.joinPath(ctx.testWorkspace!.uri, folderName);
    
    // Clean any existing test artifacts
    try {
      await vscode.workspace.fs.delete(folderUri, { recursive: true });
    } catch {}
    try {
      await ctx.remoteVerifier!.deleteFolder(folderName);
    } catch {}
    await wait(500);
    
    // Create folder with files on remote only
    await ctx.remoteVerifier!.createFile(`${folderName}/file1.txt`, 'content1');
    await ctx.remoteVerifier!.createFile(`${folderName}/file2.txt`, 'content2');
    await wait(1000);
    
    // Verify initial state
    await refresh();
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, true, `File1 should exist remotely`);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, true, `File2 should exist remotely`);
    
    const file1 = vscode.Uri.joinPath(folderUri, 'file1.txt');
    const file2 = vscode.Uri.joinPath(folderUri, 'file2.txt');
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, file1, 'removed');
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, file2, 'removed');
    
    // Execute delete folder command
    await vscode.commands.executeCommand('livesync.deleteFolder', folderUri);
    await wait(2000);
    
    // Verify files deleted remotely
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, false, `File1 should be deleted remotely`);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, false, `File2 should be deleted remotely`);
  });

  test('Delete Folder (Both) - removes from both local and remote', async () => {
    const folderName = 'delete-folder-both';
    const folderUri = vscode.Uri.joinPath(ctx.testWorkspace!.uri, folderName);
    
    // Clean any existing test artifacts
    try {
      await vscode.workspace.fs.delete(folderUri, { recursive: true });
    } catch {}
    try {
      await ctx.remoteVerifier!.deleteFolder(folderName);
    } catch {}
    await wait(500);
    
    // Create folder with files locally and upload
    await vscode.workspace.fs.createDirectory(folderUri);
    const file1 = vscode.Uri.joinPath(folderUri, 'file1.txt');
    const file2 = vscode.Uri.joinPath(folderUri, 'file2.txt');
    await vscode.workspace.fs.writeFile(file1, Buffer.from('content1'));
    await vscode.workspace.fs.writeFile(file2, Buffer.from('content2'));
    await wait(1000);
    
    // Upload folder
    await vscode.commands.executeCommand('livesync.uploadFolder', folderUri);
    await wait(3000);
    
    // Verify initial state
    await refresh();
    await assertLocalExists(file1, true, `File1 should exist locally`);
    await assertLocalExists(file2, true, `File2 should exist locally`);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, true, `File1 should exist remotely`);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, true, `File2 should exist remotely`);
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, file1, 'unchanged');
    await assertFileStatus(ctx.services!, ctx.testWorkspace!, file2, 'unchanged');
    
    // Execute delete folder command (in test mode, deletes both)
    await vscode.commands.executeCommand('livesync.deleteFolder', folderUri);
    await wait(2000);
    
    // Verify folder deleted from both sides
    await assertLocalExists(folderUri, false, `Folder should be deleted locally`);
    await assertLocalExists(file1, false, `File1 should be deleted locally`);
    await assertLocalExists(file2, false, `File2 should be deleted locally`);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, false, `File1 should be deleted remotely`);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file2.txt`, false, `File2 should be deleted remotely`);
  });
});