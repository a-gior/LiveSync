/**
 * E2E Tests - Create Event
 * Tests all actionOnCreate policy values: none, create, check, check&create
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
  assertLocalContent,
  cleanAllTestFiles
} from './e2e-shared-helpers';

suite('E2E - Create Event', function() {
  this.timeout(60000);

  let ctx: Partial<E2ETestContext> = {};
  let testFile: vscode.Uri;
  const testFileName = 'create-test.txt';
  const initialContent = ''; // Content is empty on creation
  const conflictContent = 'File already exists on remote';

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
   * Helper to create file using WorkspaceEdit (triggers internal VS Code create event)
   */
  async function createFileWithEvent(uri: vscode.Uri): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
    await vscode.workspace.applyEdit(edit);
    await wait(500);
    
    // Write content
    // await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    
    // Open the file
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  }

  /**
   * Test helper: Create file and verify expected behavior
   */
  async function testCreateBehavior(
    policy: string,
    expectedStatusAfterCreate: 'added' | 'unchanged',
    shouldExistRemotelyAfterCreate: boolean
  ): Promise<void> {
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnCreate: policy
    });
    
    // Create file
    await createFileWithEvent(testFile);
    await wait(2000);
    
    // Verify post-create state
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, expectedStatusAfterCreate);
    await assertRemoteExists(ctx.remoteVerifier!, testFileName, shouldExistRemotelyAfterCreate);
  }

  /**
   * Test helper: Create conflict scenario and verify behavior based on user response
   */
  async function testConflictBehavior(
    policy: 'check&create' | 'check',
    userResponse: 'proceed' | 'cancel' | 'ignore',
    expectedRemoteContentAfter: string,
    shouldBeIgnored: boolean = false
  ): Promise<void> {
    await refresh();
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnCreate: policy
    });
    
    // Set test response before triggering conflict
    await setTestResponse(userResponse);
    
    // Step 1: Create file on remote first (creates conflict)
    await ctx.remoteVerifier!.createFile(testFileName, conflictContent);
    await wait(500);
    
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, conflictContent, "Remote file should exist before local create");
    
    // Step 2: Create file locally (triggers conflict detection)
    await createFileWithEvent(testFile);
    await wait(1000);
    
    // Step 3: Verify behavior based on response
    await assertLocalContent(testFile, expectedRemoteContentAfter, "Local content should match expected after conflict resolution");
    
    // Verify file status after conflict handling
    if (userResponse === 'proceed' && policy === 'check&create') {
      // Proceeded with upload - should be synced
      assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'unchanged');
    } else if (userResponse === 'ignore' || userResponse === 'cancel' || policy === 'check') {
      // Didn't upload - local and remote differ
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

  test('Create with actionOnCreate=none - no sync occurs', async () => {
    await testCreateBehavior('none', 'added', false);
  });

  test('Create with actionOnCreate=create - uploads to remote', async () => {
    await testCreateBehavior('create', 'unchanged', true);
  });

  test('Create with actionOnCreate=check&create - creates when no conflict', async () => {
    await testCreateBehavior('check&create', 'unchanged', true);
  });

  test('Create with actionOnCreate=check - only checks, no create', async () => {
    await testCreateBehavior('check', 'added', false);
  });

  // ==========================================================================
  // CONFLICT TESTS
  // ==========================================================================

  test('Conflict with check&create - user clicks Proceed', async () => {
    await testConflictBehavior('check&create', 'proceed', conflictContent, false);
  });

  test('Conflict with check&create - user clicks Cancel', async () => {
    await testConflictBehavior('check&create', 'cancel', initialContent, false);
  });

  test('Conflict with check&create - user clicks Ignore', async () => {
    await testConflictBehavior('check&create', 'ignore', initialContent, true);
  });

  test('Conflict with check - user clicks Cancel', async () => {
    await testConflictBehavior('check', 'cancel', initialContent, false);
  });

});