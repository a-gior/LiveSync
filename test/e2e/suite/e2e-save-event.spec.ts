/**
 * E2E Tests - Save Event
 * Tests all actionOnSave policy values: none, save, check, check&save
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { E2E_VM_CONFIG, RemoteStateVerifier } from '../../helpers/remote/RemoteStateVerifier';
import { relFromAbs } from '../../../src/infrastructure/helpers/path';
import { getWorkspaceId } from '../../../src/infrastructure/helpers/workspaceFolder';
import { Services } from '../../../src/extension/services';

let services: Services;

suite('E2E - Save Event', function() {
  this.timeout(60000);

  let testWorkspace: vscode.WorkspaceFolder;
  let configPath: string;
  let remoteVerifier: RemoteStateVerifier;
  let testFile: vscode.Uri;
  const testFileName = 'save-test.txt';
  const initialContent = 'Initial content for save test';
  const modifiedContent = 'Modified content after save';
  const conflictContent = 'Remote was modified by someone else';

  suiteSetup(async () => {
    await vscode.commands.executeCommand('livesync.test.enableTestMode');

    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Workspace required');
    testWorkspace = folders[0];
    
    const ext = vscode.extensions.getExtension('agior.livesync');
    assert.ok(ext, 'Extension not found');
    
    if (!ext.isActive) {
      await ext.activate();
    }

    services = ext.exports.getServices();
    assert.ok(services, 'Services not available');

    remoteVerifier = new RemoteStateVerifier(E2E_VM_CONFIG);
    testFile = vscode.Uri.joinPath(testWorkspace.uri, testFileName);
    
    // Clean remote workspace
    try {
      await remoteVerifier.cleanRemoteWorkspace();
    } catch (err) {
      console.warn('Failed to clean remote workspace:', err);
    }
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('livesync.test.disableTestMode');
    remoteVerifier.dispose();
    try {
      await fs.rm(configPath, { force: true });
    } catch {}
  });

  setup(async () => {
    // Clean local test file
    try {
      await vscode.workspace.fs.delete(testFile);
    } catch {}
    
    // Clean remote test file
    try {
      await remoteVerifier.deleteFile(testFileName);
    } catch {}
  });

  /**
   * Helper to create config with specific actionOnSave policy
   */
  async function createConfig(actionOnSave: string): Promise<void> {
    configPath = path.join(testWorkspace.uri.fsPath, '.vscode', 'livesync.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: E2E_VM_CONFIG.hostname,
      port: E2E_VM_CONFIG.port,
      username: E2E_VM_CONFIG.username,
      password: E2E_VM_CONFIG.password,
      remotePath: E2E_VM_CONFIG.remotePath,
      actionOnSave: actionOnSave,
      actionOnUpload: 'upload',
      ignoreList: ['.vscode', '.livesync']
    }));
    
    // Wait for config to load
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Helper to create and open test file
   */
  async function createAndOpenFile(): Promise<vscode.TextEditor> {
    await vscode.workspace.fs.writeFile(testFile, Buffer.from(initialContent));
    const doc = await vscode.workspace.openTextDocument(testFile);
    return await vscode.window.showTextDocument(doc);
  }

  /**
   * Helper to modify and save file
   */
  async function modifyAndSave(editor: vscode.TextEditor, content: string = modifiedContent): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    edit.replace(testFile, fullRange, content);
    
    await vscode.workspace.applyEdit(edit);
    await editor.document.save();
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  function getFileStatus(workspaceFolder: vscode.WorkspaceFolder, uri: vscode.Uri) {
    const workspaceId = getWorkspaceId(workspaceFolder);
    const relPath = relFromAbs(workspaceFolder.uri.fsPath, uri.fsPath);
    return services.state.getDiffEntry(workspaceId, relPath)?.status;
  }

  // function getFileEntry(workspaceFolder: vscode.WorkspaceFolder, uri: vscode.Uri) {
  //   const workspaceId = getWorkspaceId(workspaceFolder);
  //   const relPath = relFromAbs(workspaceFolder.uri.fsPath, uri.fsPath);
  //   return services.state.getDiffEntry(workspaceId, relPath);
  // }

  /**
   * Test helper: Create file, save it, and verify expected behavior
   */
  async function testSaveBehavior(
    policy: string,
    expectedStatusAfterSave: 'added' | 'unchanged' | 'modified',
    shouldExistRemotelyAfterSave: boolean
  ): Promise<void> {
    await vscode.commands.executeCommand('livesync.refresh');
    await createConfig(policy);
    
    // Create file and open in editor
    const editor = await createAndOpenFile();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify initial state: file added locally
    const initialStatus = getFileStatus(testWorkspace, testFile);
    assert.strictEqual(initialStatus, 'added', 'File status should be "added" after creation');
    
    const existsBefore = await remoteVerifier.fileExists(testFileName);
    assert.strictEqual(existsBefore, false, 'File should not exist on remote initially');
    
    // Modify and save
    await modifyAndSave(editor);
    
    // Verify post-save state
    const statusAfterSave = getFileStatus(testWorkspace, testFile);
    assert.strictEqual(
      statusAfterSave, 
      expectedStatusAfterSave, 
      `File status should be "${expectedStatusAfterSave}" after save with policy=${policy}`
    );
    
    const existsAfterSave = await remoteVerifier.fileExists(testFileName);
    assert.strictEqual(
      existsAfterSave, 
      shouldExistRemotelyAfterSave, 
      `File should ${shouldExistRemotelyAfterSave ? '' : 'not '}exist on remote after save with policy=${policy}`
    );
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
    await vscode.commands.executeCommand('livesync.refresh');
    await createConfig(policy);
    
    // Set test response before triggering conflict
    await vscode.commands.executeCommand('livesync.test.setConflictResponse', userResponse);
    
    // Step 1: Create file and upload
    const editor = await createAndOpenFile();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify: File should be "added" (local only)
    let status = getFileStatus(testWorkspace, testFile);
    assert.strictEqual(status, 'added', 'File status should be "added" after creation');

    await vscode.commands.executeCommand('livesync.upload', testFile);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify uploaded and status should be "unchanged" (synced)
    const existsAfterUpload = await remoteVerifier.fileExists(testFileName);
    assert.strictEqual(existsAfterUpload, true, 'File should be uploaded to remote');
    
    status = getFileStatus(testWorkspace, testFile);
    assert.strictEqual(status, 'unchanged', 'File status should be "unchanged" after upload');
    
    // Step 2: Modify remote file (create conflict)
    await remoteVerifier.createFile(testFileName, conflictContent);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify remote has conflict content
    let remoteContentBefore = await remoteVerifier.readFile(testFileName);
    assert.strictEqual(remoteContentBefore.trim(), conflictContent, 'Remote should have conflict content');
    
    // Note: Status still "unchanged" because we haven't refreshed yet
    // The conflict will be detected during the save operation
    
    // Step 3: Modify local file and save (triggers conflict detection and response)
    await modifyAndSave(editor);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 4: Verify behavior based on response
    const remoteContentAfter = await remoteVerifier.readFile(testFileName);
    assert.strictEqual(
      remoteContentAfter.trim(),
      expectedRemoteContentAfter,
      `Remote content should be "${expectedRemoteContentAfter}" after ${userResponse} with policy=${policy}`
    );
    
    const localContentAfter = await vscode.workspace.fs.readFile(testFile);
    assert.strictEqual(
      localContentAfter.toString(),
      expectedLocalContentAfter,
      `Local content should be "${expectedLocalContentAfter}" after ${userResponse}`
    );
    
    // Verify file status after conflict handling
    status = getFileStatus(testWorkspace, testFile);
    if (userResponse === 'proceed' && policy === 'check&save') {
      // Proceeded with upload - should be synced
      assert.strictEqual(status, 'unchanged', 'File status should be "unchanged" after proceed');
    } else if (userResponse === 'ignore' || userResponse === 'cancel' || policy === 'check') {
      // Didn't upload - local and remote differ
      assert.strictEqual(status, 'modified', 'File status should be "modified" after cancel/ignore or check-only');
    }
    
    // Verify conflict ignored status if applicable
    if (shouldBeIgnored) {
      const workspaceId = getWorkspaceId(testWorkspace);
      const relPath = relFromAbs(testWorkspace.uri.fsPath, testFile.fsPath);
      const isIgnored = services.state.isConflictIgnored(workspaceId, relPath);
      
      assert.ok(isIgnored, 'Conflict should be marked as ignored in state');
    }
    
    // Clear test response
    await vscode.commands.executeCommand('livesync.test.setConflictResponse', null);
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
    await testConflictBehavior(
      'check&save',
      'proceed',
      modifiedContent, // Remote should have new content
      modifiedContent, // Local has new content
      false // Not ignored
    );
  });

  test('Conflict with check&save - user clicks Cancel', async () => {
    await testConflictBehavior(
      'check&save',
      'cancel',
      conflictContent, // Remote unchanged
      modifiedContent, // Local has new content
      false // Not ignored
    );
  });

  test('Conflict with check&save - user clicks Ignore', async () => {
    await testConflictBehavior(
      'check&save',
      'ignore',
      conflictContent, // Remote should be unchanged (ignore means no save)
      modifiedContent, // Local has new content
      true // Marked as ignored
    );
  });

  test('Conflict with check - user clicks Proceed', async () => {
    await testConflictBehavior(
      'check',
      'proceed',
      conflictContent, // Remote unchanged (check-only, no save)
      modifiedContent, // Local has new content
      false // Not ignored
    );
  });

  test('Conflict with check - user clicks Cancel', async () => {
    await testConflictBehavior(
      'check',
      'cancel',
      conflictContent, // Remote unchanged
      modifiedContent, // Local has new content
      false // Not ignored
    );
  });

  test('Conflict with check - user clicks Ignore', async () => {
    await testConflictBehavior(
      'check',
      'ignore',
      conflictContent, // Remote should be unchanged (ignore means no save)
      modifiedContent, // Local has new content
      true // Marked as ignored
    );
  });
});