/**
 * E2E Tests - Open Event
 * Tests all actionOnOpen policy values: none, download, check, check&download
 * 
 * Each test uses a unique filename for complete isolation
 */

import * as vscode from 'vscode';
import {
  setupE2ESuite,
  teardownE2ESuite,
  createTestConfig,
  cleanTestFile,
  assertFileStatus,
  assertRemoteContent,
  assertLocalContent,
  assertConflictIgnored,
  setTestResponse,
  refresh,
  wait,
  type E2ETestContext,
  cleanAllTestFiles
} from './e2e-shared-helpers';
import { DiffStatus } from '../../../src/domain/types';

suite('E2E - Open Event', function() {
  this.timeout(60000);

  const ctx: Partial<E2ETestContext> = {};
  
  const remoteContent = 'Remote content';
  const localContent = 'Local content';
  const conflictContent = 'Remote was modified';

  suiteSetup(async () => {
    const setup = await setupE2ESuite();
    Object.assign(ctx, setup);
    
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
   * Helper: Open file with preview disabled to properly trigger onDidOpenTextDocument
   */
  async function openFile(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Test helper: Create file locally, create on remote, open local file to trigger onOpen
   */
  async function testOpenBehavior(
    testFile: vscode.Uri,
    testFileName: string,
    policy: string,
    expectedLocalContent: string,
    expectedStatusAfterOpen: DiffStatus
  ): Promise<void> {
    // Clean this specific test file
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnOpen: policy
    });
    await refresh();
    
    // Step 1: Create file locally with initial content
    await vscode.workspace.fs.writeFile(testFile, Buffer.from(localContent));
    await wait(500);
    
    // Verify initial state: file exists locally
    await assertLocalContent(testFile, localContent, "Initial local content");
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');
    
    // Step 2: Create file on remote with different content
    await ctx.remoteVerifier!.createFile(testFileName, remoteContent);
    await wait(500);
    
    // Verify remote exists with remote content
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, remoteContent);
    
    // Step 3: Refresh to update snapshots
    await refresh();
    await wait(500);
    
    // File should show as "modified" (exists both places with different content)
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'modified');
    
    // Step 4: Open the file (triggers onOpen event)
    await openFile(testFile);
    await wait(1000);
    
    // Step 5: Verify behavior based on policy
    await assertLocalContent(testFile, expectedLocalContent, "Local content after open");
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, expectedStatusAfterOpen);
  }

  /**
   * Test helper: Create conflict scenario (local and remote both exist with different content)
   */
  async function testConflictBehavior(
    testFile: vscode.Uri,
    testFileName: string,
    policy: 'check&download' | 'check',
    userResponse: 'proceed' | 'cancel' | 'ignore',
    expectedLocalContent: string,
    shouldBeIgnored: boolean = false
  ): Promise<void> {
    // Clean this specific test file
    await cleanTestFile(testFile, testFileName, ctx.remoteVerifier!, ctx.services!, ctx.testWorkspace!);
    
    
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnOpen: policy
    });
    await refresh();
    
    // Set test response before triggering conflict
    await setTestResponse(userResponse);
    
    // Step 1: Create file locally with initial content
    await vscode.workspace.fs.writeFile(testFile, Buffer.from(localContent));
    await wait(500);
    
    // Verify initial state: file exists locally
    await assertLocalContent(testFile, localContent, "Initial local content");
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'added');
    
    // Step 2: Create file on remote with different content (conflict)
    await ctx.remoteVerifier!.createFile(testFileName, remoteContent);
    await wait(500);
    
    // Verify remote exists with remote content
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, remoteContent);
    
    // Step 3: Refresh to update snapshots
    await refresh();
    await wait(500);
    
    // File should show as "modified" (conflict: both places have different content)
    assertFileStatus(ctx.services!, ctx.testWorkspace!, testFile, 'modified');
    
    // Step 4: Update file on remote with different content (conflict)
    await ctx.remoteVerifier!.createFile(testFileName, conflictContent);
    await wait(500);

    // Step 5: Open the file (triggers onOpen event with conflict detection)
    await openFile(testFile);
    await wait(1000);
    
    // Step 6: Verify behavior based on response
    await assertLocalContent(testFile, expectedLocalContent, "Local content after conflict open");
    
    // Verify remote content (should not change regardless of response - onOpen only downloads)
    await assertRemoteContent(ctx.remoteVerifier!, testFileName, conflictContent);
    
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

  test('Open with actionOnOpen=none - no download occurs', async () => {
    const testFileName = 'open-none.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    await testOpenBehavior(testFile, testFileName, 'none', localContent, 'modified');
  });

  test('Open with actionOnOpen=download - downloads from remote', async () => {
    const testFileName = 'open-download.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    await testOpenBehavior(testFile, testFileName, 'download', remoteContent, 'unchanged');
  });

  // Useless test since any difference is a conflict
  // test('Open with actionOnOpen=check&download - downloads when no conflict', async () => {
  //   const testFileName = 'open-check-download.txt';
  //   const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
  //   await testOpenBehavior(testFile, testFileName, 'check&download', remoteContent, 'unchanged');
  // });

  test('Open with actionOnOpen=check - only checks, no download', async () => {
    const testFileName = 'open-check.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    await testOpenBehavior(testFile, testFileName, 'check', localContent, 'modified');
  });

  // ==========================================================================
  // CONFLICT TESTS
  // ==========================================================================

  test('Conflict with check&download - user clicks Proceed (downloads despite conflict)', async () => {
    const testFileName = 'open-conflict-proceed.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    await testConflictBehavior(testFile, testFileName, 'check&download', 'proceed', conflictContent, false);
  });

  test('Conflict with check&download - user clicks Cancel (keeps local file)', async () => {
    const testFileName = 'open-conflict-cancel.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    await testConflictBehavior(testFile, testFileName, 'check&download', 'cancel', localContent, false);
  });

  test('Conflict with check&download - user clicks Ignore (keeps local file, marks ignored)', async () => {
    const testFileName = 'open-conflict-ignore.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    await testConflictBehavior(testFile, testFileName, 'check&download', 'ignore', localContent, true);
  });

  test('Conflict with check - shows prompt but no download action', async () => {
    const testFileName = 'open-conflict-check-only.txt';
    const testFile = vscode.Uri.joinPath(ctx.testWorkspace!.uri, testFileName);
    await testConflictBehavior(testFile, testFileName, 'check', 'proceed', localContent, false);
  });
});