/**
 * E2E Tests - Delete Event
 * Tests all actionOnDelete policy values: none, delete, check, check&delete
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
  assertConflictIgnored,
  setTestResponse,
  refresh,
  wait,
  type E2ETestContext,
  cleanAllTestFiles
} from './e2e-shared-helpers';

suite('E2E - Delete Event', function() {
  this.timeout(60000);

  let ctx: Partial<E2ETestContext> = {};
  let testFile: vscode.Uri;
  const testFileName = 'delete-test.txt';
  const initialContent = 'Initial content for delete test';
  const conflictContent = 'Remote was modified';

  suiteSetup(async () => {
    const setup = await setupE2ESuite();
    Object.assign(ctx, setup);
    testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    
    await cleanAllTestFiles(ctx.remoteVerifier!);
  });

  suiteTeardown(async () => {
    await teardownE2ESuite(ctx.remoteVerifier!, ctx.configPath);
  });

  setup(async () => {
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
  });

  /**
   * Helper to delete file using WorkspaceEdit (triggers internal VS Code delete event)
   */
  async function deleteFileWithEvent(uri: vscode.Uri): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.deleteFile(uri, { ignoreIfNotExists: true });
    await vscode.workspace.applyEdit(edit);
    await wait(500);
  }

  /**
   * Test helper: Create and upload file, then delete it and verify expected behavior
   */
  async function testDeleteBehavior(
    policy: string,
    shouldExistRemotelyAfterDelete: boolean
  ): Promise<void> {
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnDelete: policy
    });
    await refresh();
    
    // Step 1: Create file locally and upload to remote
    await createAndOpenFile(testFile, initialContent);
    await wait(500);
    
    // Verify initial state: file added locally
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');
    
    // Upload to remote
    await vscode.commands.executeCommand('livesync.upload', testFile);
    await wait(1000);
    
    // Verify file is synced
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, true);
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'unchanged');
    
    // Step 2: Delete file locally
    await deleteFileWithEvent(testFile);
    await wait(2000);
    
    // Step 3: Verify post-delete state
    // Local file should no longer exist
    try {
      await vscode.workspace.fs.stat(testFile);
      throw new Error('File should have been deleted locally');
    } catch (err: any) {
      if (err.message === 'File should have been deleted locally') {
        throw err;
      }
      // Expected: file not found
    }
    
    // Remote file status depends on policy
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, shouldExistRemotelyAfterDelete);
  }

  /**
   * Test helper: Create conflict scenario and verify behavior based on user response
   */
  async function testConflictBehavior(
    policy: 'check&delete' | 'check',
    userResponse: 'proceed' | 'cancel' | 'ignore',
    shouldExistRemotelyAfterDelete: boolean,
    shouldBeIgnored: boolean = false
  ): Promise<void> {
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnDelete: policy
    });
    await refresh();
    
    // Set test response before triggering conflict
    await setTestResponse(userResponse);
    
    // Step 1: Create file locally and upload
    await createAndOpenFile(testFile, initialContent);
    await wait(500);
    
    await vscode.commands.executeCommand('livesync.upload', testFile);
    await wait(1000);
    
    // Verify uploaded
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, true);
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, initialContent);
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'unchanged');
    
    // Step 2: Modify remote file (create conflict - file changed since last sync)
    await ctx.remoteVerifier!.createFile(testFileName, conflictContent);
    await wait(500);
    
    // Verify remote has conflict content
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, conflictContent);
    
    // Step 3: Delete file locally (triggers conflict detection and response)
    await deleteFileWithEvent(testFile);
    await wait(2000);
    
    // Step 4: Verify behavior based on response
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, shouldExistRemotelyAfterDelete);
    
    // Verify local file deleted regardless of conflict
    try {
      await vscode.workspace.fs.stat(testFile);
      throw new Error('File should have been deleted locally');
    } catch (err: any) {
      if (err.message === 'File should have been deleted locally') {
        throw err;
      }
      // Expected: file not found
    }
    
    // Verify remote content if file still exists
    if (shouldExistRemotelyAfterDelete) {
      await assertRemoteContent(ctx.remoteVerifier!, testFileName, conflictContent);
    }
    
    // Verify conflict ignored status if applicable
    if (shouldBeIgnored) {
      assertConflictIgnored(ctx.services!, ctx.testWorkspace!, testFile, true);
    }
    
    // Clear test response
    await setTestResponse(null);
  }

  // ==========================================================================
  // CLASSIC TESTS
  // ==========================================================================

  test('Delete with actionOnDelete=none - no remote delete occurs', async () => {
    await testDeleteBehavior('none', true); // Remote file remains
  });

  test('Delete with actionOnDelete=delete - deletes from remote', async () => {
    await testDeleteBehavior('delete', false); // Remote file deleted
  });

  test('Delete with actionOnDelete=check&delete - deletes when no conflict', async () => {
    await testDeleteBehavior('check&delete', false); // Remote file deleted
  });

  test('Delete with actionOnDelete=check - only checks, no delete', async () => {
    await testDeleteBehavior('check', true); // Remote file remains (check only)
  });

  // ==========================================================================
  // CONFLICT TESTS
  // ==========================================================================

  test('Conflict with check&delete - user clicks Proceed (deletes despite conflict)', async () => {
    await testConflictBehavior('check&delete', 'proceed', false, false);
  });

  test('Conflict with check&delete - user clicks Cancel (keeps remote file)', async () => {
    await testConflictBehavior('check&delete', 'cancel', true, false);
  });

  test('Conflict with check&delete - user clicks Ignore (keeps remote file, marks ignored)', async () => {
    await testConflictBehavior('check&delete', 'ignore', true, true);
  });

  test('Conflict with check - shows prompt but no delete action', async () => {
    await testConflictBehavior('check', 'proceed', true, false);
  });
});