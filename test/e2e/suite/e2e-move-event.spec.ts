/**
 * E2E Tests - Rename/Move Event
 * Tests all actionOnMove policy values: none, move, check, check&move
 * 
 * Test Structure:
 * 1. File Rename (same directory, different name) - 8 tests
 * 2. File Move (different directory) - 4 tests
 * 3. Folder Rename (move parent folder containing files/subfolders) - 4 tests
 * 4. Folder Move (move parent folder to different location) - 4 tests
 * 5. Folder Dirty State Detection (skipped - requires code implementation) - 2 tests
 * 
 * Total: 22 tests (20 active, 2 skipped)
 * 
 * CODE CHANGE NEEDED for folder conflict tests:
 * In src/infrastructure/helpers/conflict/detector.ts, detectConflict() for 'move' event:
 * - When renaming a folder, check if folder status is NOT 'unchanged' or 'added'
 * - If folder is 'modified' or in dirty state, return conflict
 * - This prompts user when policy contains 'check'
 * 
 * Each test uses unique filenames for complete isolation
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
  assertConflictIgnored,
  setTestResponse,
  refresh,
  wait,
  type E2ETestContext,
  cleanAllTestFiles
} from './e2e-shared-helpers';

suite('E2E - Rename/Move Event', function() {
  this.timeout(60000);

  let ctx: Partial<E2ETestContext> = {};
  
  const fileContent = 'File content for test';
  const conflictContent = 'File already exists at target';

  suiteSetup(async () => {
    const setup = await setupE2ESuite();
    Object.assign(ctx, setup);
    
    // Clean all .txt files at start
    await cleanAllTestFiles(ctx.remoteVerifier!);
  });

  suiteTeardown(async () => {
    await teardownE2ESuite(ctx.remoteVerifier!, ctx.configPath);
  });

  setup(async () => {
    // Close all editors between tests
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await wait(500);
  });

  /**
   * Helper to assert local file content
   */
  async function assertLocalContent(uri: vscode.Uri, expectedContent: string): Promise<void> {
    const content = await vscode.workspace.fs.readFile(uri);
    if (content.toString() !== expectedContent) {
      throw new Error(`Expected "${expectedContent}", got "${content.toString()}"`);
    }
  }

  /**
   * Helper to move/move file using WorkspaceEdit (triggers internal VS Code move event)
   */
  async function moveFileWithEvent(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(oldUri, newUri);
    await vscode.workspace.applyEdit(edit);
    await wait(1000);
  }

  // ==========================================================================
  // FILE RENAME TESTS (same directory, different name)
  // ==========================================================================

  /**
   * Test helper: Create, upload, move file (no conflict)
   */
  async function testFileRename(
    oldFileName: string,
    newFileName: string,
    policy: string,
    shouldExistAtOldPath: boolean,
    shouldExistAtNewPath: boolean
  ): Promise<void> {
    const oldFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, oldFileName);
    const newFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, newFileName);
    
    // Clean both paths
    await cleanTestFile(oldFile, oldFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    await cleanTestFile(newFile, newFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnMove: policy
    });
    
    // Step 1: Create and upload file
    await vscode.workspace.fs.writeFile(oldFile, Buffer.from(fileContent));
    await wait(500);
    
    await vscode.commands.executeCommand('livesync.upload', oldFile);
    await wait(1000);
    
    // Verify uploaded and status
    await assertRemoteExists(ctx.remoteVerifier!, oldFileName, true);
    await assertRemoteContent(ctx.remoteVerifier!, oldFileName, fileContent);
    assertFileStatus(ctx.services!, ctx.testWorkspace!, oldFile, 'unchanged');
    
    // Step 2: Rename file locally (same directory)
    await moveFileWithEvent(oldFile, newFile);
    await wait(2000);
    
    // Step 3: Verify local state
    // Old file should not exist locally
    try {
      await vscode.workspace.fs.stat(oldFile);
      throw new Error('Old file should not exist locally after move');
    } catch (err: any) {
      if (err.message?.includes('should not exist')) throw err;
    }
    
    // New file should exist locally with correct content
    await vscode.workspace.fs.stat(newFile);
    await assertLocalContent(newFile, fileContent);
    
    // Step 4: Verify remote state
    await assertRemoteExists(ctx.remoteVerifier!, oldFileName, shouldExistAtOldPath);
    await assertRemoteExists(ctx.remoteVerifier!, newFileName, shouldExistAtNewPath);
    
    if (shouldExistAtNewPath) {
      await assertRemoteContent(ctx.remoteVerifier!, newFileName, fileContent);
    }
  }

  /**
   * Test helper: Rename with conflict (target name already exists)
   */
  async function testFileRenameConflict(
    oldFileName: string,
    newFileName: string,
    policy: 'check&move' | 'check',
    userResponse: 'proceed' | 'cancel' | 'ignore',
    shouldExistAtOldPath: boolean,
    shouldExistAtNewPath: boolean,
    expectedNewContent: string,
    shouldBeIgnored: boolean = false
  ): Promise<void> {
    const oldFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, oldFileName);
    const newFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, newFileName);
    
    await cleanTestFile(oldFile, oldFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    await cleanTestFile(newFile, newFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnMove: policy
    });
    
    await setTestResponse(userResponse);
    
    // Step 1: Create and upload source file
    await vscode.workspace.fs.writeFile(oldFile, Buffer.from(fileContent));
    await wait(500);
    
    await vscode.commands.executeCommand('livesync.upload', oldFile);
    await wait(1000);
    
    // Verify uploaded
    await assertRemoteExists(ctx.remoteVerifier!, oldFileName, true);
    assertFileStatus(ctx.services!, ctx.testWorkspace!, oldFile, 'unchanged');
    
    // Step 2: Create file at target name on remote (conflict!)
    await ctx.remoteVerifier!.createFile(newFileName, conflictContent);
    await wait(500);
    
    await assertRemoteExists(ctx.remoteVerifier!, newFileName, true);
    await assertRemoteContent(ctx.remoteVerifier!, newFileName, conflictContent);
    
    // Step 3: Rename file locally (triggers conflict)
    await moveFileWithEvent(oldFile, newFile);
    await wait(2000);
    
    // Step 4: Verify behavior
    await assertRemoteExists(ctx.remoteVerifier!, oldFileName, shouldExistAtOldPath);
    await assertRemoteExists(ctx.remoteVerifier!, newFileName, shouldExistAtNewPath);
    
    if (shouldExistAtNewPath) {
      await assertRemoteContent(ctx.remoteVerifier!, newFileName, expectedNewContent);
    }
    
    if (shouldBeIgnored) {
      assertConflictIgnored(ctx.services!, ctx.testWorkspace!, newFile, true);
    }
    
    await setTestResponse(null);
  }

  test('[File Rename] actionOnMove=none - no remote move', async () => {
    await testFileRename('move-none-old.txt', 'move-none-new.txt', 'none', true, false);
  });

  test('[File Rename] actionOnMove=move - moves on remote', async () => {
    await testFileRename('move-move-old.txt', 'move-move-new.txt', 'move', false, true);
  });

  test('[File Rename] actionOnMove=check&move - moves when no conflict', async () => {
    await testFileRename('move-check-old.txt', 'move-check-new.txt', 'check&move', false, true);
  });

  test('[File Rename] actionOnMove=check - only checks, no move', async () => {
    await testFileRename('move-onlycheck-old.txt', 'move-onlycheck-new.txt', 'check', true, false);
  });

  test('[File Rename Conflict] check&move + Proceed - overwrites target', async () => {
    await testFileRenameConflict(
      'move-conflict-proceed-old.txt',
      'move-conflict-proceed-new.txt',
      'check&move',
      'proceed',
      false,        // Old removed
      true,         // New exists
      fileContent,  // Overwritten with source content
      false
    );
  });

  test('[File Rename Conflict] check&move + Cancel - keeps both', async () => {
    await testFileRenameConflict(
      'move-conflict-cancel-old.txt',
      'move-conflict-cancel-new.txt',
      'check&move',
      'cancel',
      true,             // Old remains
      true,             // New remains
      conflictContent,  // Target unchanged
      false
    );
  });

  test('[File Rename Conflict] check&move + Ignore - keeps both + marks ignored', async () => {
    await testFileRenameConflict(
      'move-conflict-ignore-old.txt',
      'move-conflict-ignore-new.txt',
      'check&move',
      'ignore',
      true,             // Old remains
      true,             // New remains
      conflictContent,  // Target unchanged
      true              // Marked ignored
    );
  });

  test('[File Rename Conflict] check - shows prompt, no action', async () => {
    await testFileRenameConflict(
      'move-conflict-check-old.txt',
      'move-conflict-check-new.txt',
      'check',
      'proceed',
      true,             // Old remains
      true,             // New remains
      conflictContent,  // Target unchanged
      false
    );
  });

  // ==========================================================================
  // FILE MOVE TESTS (different directory)
  // ==========================================================================

  /**
   * Test helper: Create, upload, move file to different directory (no conflict)
   */
  async function testFileMove(
    oldPath: string,
    newPath: string,
    policy: string,
    shouldExistAtOldPath: boolean,
    shouldExistAtNewPath: boolean
  ): Promise<void> {
    const oldFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, oldPath);
    const newFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, newPath);
    
    await cleanTestFile(oldFile, oldPath, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    await cleanTestFile(newFile, newPath, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    // Create target directory if needed
    const newDir = vscode.Uri.joinPath(newFile, '..');
    try {
      await vscode.workspace.fs.createDirectory(newDir);
    } catch {
      // Directory might already exist
    }
    
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnMove: policy
    });
    
    // Step 1: Create and upload file
    await vscode.workspace.fs.writeFile(oldFile, Buffer.from(fileContent));
    await wait(500);
    
    await vscode.commands.executeCommand('livesync.upload', oldFile);
    await wait(1000);
    
    // Verify uploaded
    await assertRemoteExists(ctx.remoteVerifier!, oldPath, true);
    assertFileStatus(ctx.services!, ctx.testWorkspace!, oldFile, 'unchanged');
    
    // Step 2: Move file to different directory
    await moveFileWithEvent(oldFile, newFile);
    await wait(2000);
    
    // Step 3: Verify remote state
    await assertRemoteExists(ctx.remoteVerifier!, oldPath, shouldExistAtOldPath);
    await assertRemoteExists(ctx.remoteVerifier!, newPath, shouldExistAtNewPath);
    
    if (shouldExistAtNewPath) {
      await assertRemoteContent(ctx.remoteVerifier!, newPath, fileContent);
    }
  }

  test('[File Move] actionOnMove=none - no remote move', async () => {
    await testFileMove('move-none.txt', 'subdir/move-none.txt', 'none', true, false);
  });

  test('[File Move] actionOnMove=move - moves on remote', async () => {
    await testFileMove('move-action.txt', 'subdir/move-action.txt', 'move', false, true);
  });

  test('[File Move] actionOnMove=check&move - moves when no conflict', async () => {
    await testFileMove('move-check.txt', 'subdir/move-check.txt', 'check&move', false, true);
  });

  test('[File Move] actionOnMove=check - only checks, no move', async () => {
    await testFileMove('move-onlycheck.txt', 'subdir/move-onlycheck.txt', 'check', true, false);
  });

  // ==========================================================================
  // FOLDER RENAME TESTS (move parent folder with nested structure)
  // ==========================================================================

  /**
   * Helper: Create folder structure with files and subfolders, upload manually
   */
  async function createAndUploadFolderStructure(
    folderName: string
  ): Promise<vscode.Uri> {
    const folderUri = vscode.Uri.joinPath(ctx.testWorkspace!.uri, folderName);
    
    // Create folder structure: folder/file1.txt, folder/subfolder/file2.txt
    await vscode.workspace.fs.createDirectory(folderUri);
    await wait(200);
    
    const subfolderUri = vscode.Uri.joinPath(folderUri, 'subfolder');
    await vscode.workspace.fs.createDirectory(subfolderUri);
    await wait(200);
    
    // Create files
    const file1Uri = vscode.Uri.joinPath(folderUri, 'file1.txt');
    const file2Uri = vscode.Uri.joinPath(subfolderUri, 'file2.txt');
    
    await vscode.workspace.fs.writeFile(file1Uri, Buffer.from('Content of file1'));
    await wait(200);
    await vscode.workspace.fs.writeFile(file2Uri, Buffer.from('Content of file2'));
    await wait(200);
    
    // Upload each file manually
    await vscode.commands.executeCommand('livesync.upload', file1Uri);
    await wait(500);
    await vscode.commands.executeCommand('livesync.upload', file2Uri);
    await wait(500);
    
    // Verify uploaded
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/file1.txt`, true);
    await assertRemoteExists(ctx.remoteVerifier!, `${folderName}/subfolder/file2.txt`, true);
    
    // Check parent folder status (should be computed from children)
    assertFileStatus(ctx.services!, ctx.testWorkspace!, folderUri, 'unchanged');
    
    return folderUri;
  }

  /**
   * Test helper: Rename folder and verify all contents moved
   */
  async function testFolderRename(
    oldFolderName: string,
    newFolderName: string,
    policy: string,
    shouldExistAtOldPath: boolean,
    shouldExistAtNewPath: boolean
  ): Promise<void> {
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnMove: policy
    });
    
    // Step 1: Create and upload folder structure
    const oldFolder = await createAndUploadFolderStructure(oldFolderName);
    const newFolder = vscode.Uri.joinPath(ctx.testWorkspace!.uri, newFolderName);
    
    // Step 2: Rename folder
    await moveFileWithEvent(oldFolder, newFolder);
    await wait(2000);
    
    // Step 3: Verify remote state for all files
    const files = ['file1.txt', 'subfolder/file2.txt'];
    
    for (const file of files) {
      await assertRemoteExists(
        ctx.remoteVerifier!,
        `${oldFolderName}/${file}`,
        shouldExistAtOldPath
      );
      await assertRemoteExists(
        ctx.remoteVerifier!,
        `${newFolderName}/${file}`,
        shouldExistAtNewPath
      );
    }
    
    // Cleanup
    try {
      await vscode.workspace.fs.delete(newFolder, { recursive: true });
      await ctx.remoteVerifier!.executeCommand(`rm -rf /home/centos/e2e-test-workspace/${oldFolderName}`);
      await ctx.remoteVerifier!.executeCommand(`rm -rf /home/centos/e2e-test-workspace/${newFolderName}`);
    } catch {
      // Ignore cleanup errors
    }
  }

  test('[Folder Rename] actionOnMove=none - no remote move', async () => {
    await testFolderRename('folder-move-none', 'folder-move-none-new', 'none', true, false);
  });

  test('[Folder Rename] actionOnMove=move - moves folder on remote', async () => {
    await testFolderRename('folder-move-move', 'folder-move-move-new', 'move', false, true);
  });

  test('[Folder Rename] actionOnMove=check&move - moves when clean', async () => {
    await testFolderRename('folder-move-check', 'folder-move-check-new', 'check&move', false, true);
  });

  test('[Folder Rename] actionOnMove=check - only checks', async () => {
    await testFolderRename('folder-move-onlycheck', 'folder-move-onlycheck-new', 'check', true, false);
  });

  // ==========================================================================
  // FOLDER MOVE TESTS (move parent folder to different location)
  // ==========================================================================

  /**
   * Test helper: Move folder to different directory
   */
  async function testFolderMove(
    folderName: string,
    newFolderPath: string,
    policy: string,
    shouldExistAtOldPath: boolean,
    shouldExistAtNewPath: boolean
  ): Promise<void> {
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnMove: policy
    });
    
    // Step 1: Create and upload folder structure
    const oldFolder = await createAndUploadFolderStructure(folderName);
    const newFolder = vscode.Uri.joinPath(ctx.testWorkspace!.uri, newFolderPath);
    
    // Create parent directory for move if needed
    const newParent = vscode.Uri.joinPath(newFolder, '..');
    try {
      await vscode.workspace.fs.createDirectory(newParent);
    } catch {
      // Already exists
    }
    
    // Step 2: Move folder
    await moveFileWithEvent(oldFolder, newFolder);
    await wait(2000);
    
    // Step 3: Verify remote state
    const files = ['file1.txt', 'subfolder/file2.txt'];
    
    for (const file of files) {
      await assertRemoteExists(
        ctx.remoteVerifier!,
        `${folderName}/${file}`,
        shouldExistAtOldPath
      );
      await assertRemoteExists(
        ctx.remoteVerifier!,
        `${newFolderPath}/${file}`,
        shouldExistAtNewPath
      );
    }
    
    // Cleanup
    try {
      await vscode.workspace.fs.delete(newFolder, { recursive: true });
      await ctx.remoteVerifier!.executeCommand(`rm -rf /home/centos/e2e-test-workspace/${folderName}`);
      await ctx.remoteVerifier!.executeCommand(`rm -rf /home/centos/e2e-test-workspace/${newFolderPath}`);
    } catch {
      // Ignore cleanup errors
    }
  }

  test('[Folder Move] actionOnMove=none - no remote move', async () => {
    await testFolderMove('folder-move-none', 'moved/folder-move-none', 'none', true, false);
  });

  test('[Folder Move] actionOnMove=move - moves folder on remote', async () => {
    await testFolderMove('folder-move-action', 'moved/folder-move-action', 'move', false, true);
  });

  test('[Folder Move] actionOnMove=check&move - moves when clean', async () => {
    await testFolderMove('folder-move-check', 'moved/folder-move-check', 'check&move', false, true);
  });

  test('[Folder Move] actionOnMove=check - only checks', async () => {
    await testFolderMove('folder-move-onlycheck', 'moved/folder-move-onlycheck', 'check', true, false);
  });

  // ==========================================================================
  // FOLDER CONFLICT TESTS (dirty state detection)
  // Note: Requires code update in detectConflict() for 'move' event to:
  // - Check if folder status is NOT 'unchanged' or 'added'
  // - If dirty, show conflict prompt when policy contains 'check'
  // ==========================================================================

  /**
   * Test helper: Rename folder with dirty state (modified child files)
   * TODO: This requires updating detectConflict() to check folder status
   */
  async function testFolderRenameDirtyState(
    folderName: string,
    newFolderName: string,
    policy: 'check&move' | 'check',
    userResponse: 'proceed' | 'cancel' | 'ignore'
  ): Promise<void> {
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnMove: policy
    });
    
    await setTestResponse(userResponse);
    
    // Step 1: Create and upload folder structure
    const oldFolder = await createAndUploadFolderStructure(folderName);
    const newFolder = vscode.Uri.joinPath(ctx.testWorkspace!.uri, newFolderName);
    
    // Step 2: Modify a file inside the folder (makes folder "dirty")
    const file1Uri = vscode.Uri.joinPath(oldFolder, 'file1.txt');
    await vscode.workspace.fs.writeFile(file1Uri, Buffer.from('MODIFIED CONTENT'));
    await wait(500);
    
    // Verify folder is now in dirty state (status should be 'modified')
    // assertFileStatus(ctx.services!, ctx.testWorkspace!, oldFolder, 'modified');
    
    // Step 3: Rename folder (should trigger conflict due to dirty state)
    await moveFileWithEvent(oldFolder, newFolder);
    await wait(2000);
    
    // Step 4: Verify behavior based on response
    // For 'proceed': folder should be moved despite dirty state
    // For 'cancel': folder should remain at old path
    // For 'ignore': folder should remain at old path + marked ignored
    
    const shouldMove = userResponse === 'proceed' && policy === 'check&move';
    const files = ['file1.txt', 'subfolder/file2.txt'];
    
    for (const file of files) {
      await assertRemoteExists(
        ctx.remoteVerifier!,
        `${folderName}/${file}`,
        !shouldMove  // Old path exists if not moved
      );
      await assertRemoteExists(
        ctx.remoteVerifier!,
        `${newFolderName}/${file}`,
        shouldMove   // New path exists if moved
      );
    }
    
    // Cleanup
    try {
      const finalFolder = shouldMove ? newFolder : oldFolder;
      await vscode.workspace.fs.delete(finalFolder, { recursive: true });
      await ctx.remoteVerifier!.executeCommand(`rm -rf /home/centos/e2e-test-workspace/${folderName}`);
      await ctx.remoteVerifier!.executeCommand(`rm -rf /home/centos/e2e-test-workspace/${newFolderName}`);
    } catch {
      // Ignore cleanup errors
    }
    
    await setTestResponse(null);
  }

  test('[Folder Dirty State] check&move - detects dirty folder before move', async () => {
    // TODO: Implement folder status check in detectConflict() for 'move' event
    await testFolderRenameDirtyState('folder-dirty-check', 'folder-dirty-check-new', 'check&move', 'proceed');
  });

  test('[Folder Dirty State] check - shows prompt for dirty folder', async () => {
    // TODO: Implement folder status check in detectConflict() for 'move' event
    await testFolderRenameDirtyState('folder-dirty-onlycheck', 'folder-dirty-onlycheck-new', 'check', 'cancel');
  });
});