/**
 * E2E Tests - Save Event (REFACTORED)
 * Tests all actionOnSave policy values: none, save, check, check&save
 */

import * as vscode from 'vscode';
import {
  setupE2ESuite,
  teardownE2ESuite,
  createTestConfig,
  createAndOpenFile,
  modifyAndSave,
  cleanTestFile,
  assertFileStatus,
  assertRemoteExists,
  assertRemoteContent,
  assertLocalContent,
  assertConflictIgnored,
  setTestResponse,
  refresh,
  wait,
  type E2ETestContext
} from './e2e-shared-helpers';

suite('E2E - Save Event', function() {
  this.timeout(60000);

  let ctx: Partial<E2ETestContext> = {};
  let testFile: vscode.Uri;
  const testFileName = 'save-test.txt';
  const initialContent = 'Initial content for save test';
  const modifiedContent = 'Modified content after save';
  const conflictContent = 'Remote was modified by someone else';

  suiteSetup(async () => {
    const setup = await setupE2ESuite();
    Object.assign(ctx, setup);
    testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
  });

  suiteTeardown(async () => {
    await teardownE2ESuite(ctx.remoteVerifier!, ctx.configPath);
  });

  setup(async () => {
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
  });

  /**
   * Test helper: Create file, save it, and verify expected behavior
   */
  async function testSaveBehavior(
    policy: string,
    expectedStatusAfterSave: 'added' | 'unchanged' | 'modified',
    shouldExistRemotelyAfterSave: boolean
  ): Promise<void> {
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnSave: policy
    });
    
    // Create file and open in editor
    const editor = await createAndOpenFile(testFile, initialContent);
    await wait(500);
    
    // Verify initial state: file added locally
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, false);
    
    // Modify and save
    await modifyAndSave(editor, modifiedContent);
    
    // Verify post-save state
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, expectedStatusAfterSave);
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, shouldExistRemotelyAfterSave);
  }

  /**
   * Test helper: Create conflict scenario and verify behavior based on user response
   */
  async function testConflictBehavior(
    policy: 'check&save' | 'check',
    userResponse: 'proceed' | 'cancel' | 'ignore',
    expectedRemoteContentAfter: string,
    expectedLocalContentAfter: string,
    shouldBeIgnored: boolean = false
  ): Promise<void> {
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnSave: policy
    });
    
    // Set test response before triggering conflict
    await setTestResponse(userResponse);
    
    // Step 1: Create file and upload
    const editor = await createAndOpenFile(testFile, initialContent);
    await wait(500);
    
    // Verify: File should be "added" (local only)
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');

    await vscode.commands.executeCommand('livesync.upload', testFile);
    await wait(1000);
    
    // Verify uploaded and status should be "unchanged" (synced)
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, true);
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'unchanged');
    
    // Step 2: Modify remote file (create conflict)
    await ctx.remoteVerifier!.createFile(testFileName, conflictContent);
    await wait(1000);
    
    // Verify remote has conflict content
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, conflictContent);
    
    // Step 3: Modify local file and save (triggers conflict detection and response)
    await modifyAndSave(editor, modifiedContent);
    await wait(500);
    
    // Step 4: Verify behavior based on response
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, expectedRemoteContentAfter);
    await assertLocalContent(testFile, expectedLocalContentAfter);
    
    // Verify file status after conflict handling
    if (userResponse === 'proceed' && policy === 'check&save') {
      assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'unchanged');
    } else if (userResponse === 'ignore' || userResponse === 'cancel' || policy === 'check') {
      assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'modified');
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

  test('Save with actionOnSave=none - no sync occurs', async () => {
    await testSaveBehavior('none', 'added', false);
  });

  test('Save with actionOnSave=save - direct save without check', async () => {
    await testSaveBehavior('save', 'unchanged', true);
  });

  test('Save with actionOnSave=check&save - save when no conflict', async () => {
    await testSaveBehavior('check&save', 'unchanged', true);
  });

  test('Save with actionOnSave=check - no save when check passes', async () => {
    await testSaveBehavior('check', 'added', false);
  });

  // ==========================================================================
  // CONFLICT TESTS
  // ==========================================================================

  test('Conflict with check&save - user clicks Proceed', async () => {
    await testConflictBehavior('check&save', 'proceed', modifiedContent, modifiedContent, false);
  });

  test('Conflict with check&save - user clicks Cancel', async () => {
    await testConflictBehavior('check&save', 'cancel', conflictContent, modifiedContent, false);
  });

  test('Conflict with check&save - user clicks Ignore', async () => {
    await testConflictBehavior('check&save', 'ignore', conflictContent, modifiedContent, true);
  });

  test('Conflict with check - user clicks Cancel', async () => {
    await testConflictBehavior('check', 'cancel', conflictContent, modifiedContent, false);
  });
});