/**
 * Shared E2E Test Helpers
 * Extracts common patterns from all E2E tests to eliminate duplication
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { E2E_VM_CONFIG, RemoteStateVerifier } from '../../helpers/remote/RemoteStateVerifier';
import { relFromAbs } from '../../../src/infrastructure/helpers/path';
import { getWorkspaceId } from '../../../src/infrastructure/helpers/workspaceFolder';
import { Services } from '../../../src/extension/services';
import type { DiffStatus } from '../../../src/domain/types';

// ==========================================================================
// Test Context Setup/Teardown
// ==========================================================================

export interface E2ETestContext {
  testWorkspace: vscode.WorkspaceFolder;
  services: Services;
  remoteVerifier: RemoteStateVerifier;
  configPath: string;
}

/**
 * Standard suite setup for E2E tests
 */
export async function setupE2ESuite(): Promise<Omit<E2ETestContext, 'configPath'>> {
  await vscode.commands.executeCommand('livesync.test.enableTestMode');

  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, 'Workspace required');
  const testWorkspace = folders[0];
  
  const ext = vscode.extensions.getExtension('agior.livesync');
  assert.ok(ext, 'Extension not found');
  
  if (!ext.isActive) {
    await ext.activate();
  }

  const services = ext.exports.getServices();
  assert.ok(services, 'Services not available');

  const remoteVerifier = new RemoteStateVerifier(E2E_VM_CONFIG);
  
  // Clean remote workspace
  try {
    await remoteVerifier.cleanRemoteWorkspace();
  } catch (err) {
    console.warn('Failed to clean remote workspace:', err);
  }

  return { testWorkspace, services, remoteVerifier };
}

/**
 * Standard suite teardown for E2E tests
 */
export async function teardownE2ESuite(
  remoteVerifier: RemoteStateVerifier,
  configPath?: string
): Promise<void> {
  await vscode.commands.executeCommand('livesync.test.disableTestMode');
  remoteVerifier.dispose();
  if (configPath) {
    try {
      await fs.rm(configPath, { force: true });
    } catch {
      // Ignore errors
    }
  }
}

// ==========================================================================
// Config Management
// ==========================================================================

export interface PolicyConfig {
  actionOnSave?: string;
  actionOnCreate?: string;
  actionOnDelete?: string;
  actionOnMove?: string;
  actionOnOpen?: string;
  actionOnUpload?: string;
  actionOnDownload?: string;
}

/**
 * Create LiveSync config with specified policies
 */
export async function createTestConfig(
  testWorkspace: vscode.WorkspaceFolder,
  policies: PolicyConfig
): Promise<string> {
  const configPath = path.join(testWorkspace.uri.fsPath, '.vscode', 'livesync.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  
  await fs.writeFile(configPath, JSON.stringify({
    hostname: E2E_VM_CONFIG.hostname,
    port: E2E_VM_CONFIG.port,
    username: E2E_VM_CONFIG.username,
    password: E2E_VM_CONFIG.password,
    remotePath: E2E_VM_CONFIG.remotePath,
    actionOnSave: policies.actionOnSave || 'none',
    actionOnCreate: policies.actionOnCreate || 'none',
    actionOnDelete: policies.actionOnDelete || 'none',
    actionOnMove: policies.actionOnMove || 'none',
    actionOnOpen: policies.actionOnOpen || 'none',
    actionOnUpload: policies.actionOnUpload || 'upload',
    actionOnDownload: policies.actionOnDownload || 'download',
    ignoreList: ['.vscode', '.livesync']
  }));
  
  // Wait for config to load
  await wait(2000);
  
  return configPath;
}

// ==========================================================================
// File Operations
// ==========================================================================

/**
 * Create and open file in editor
 */
export async function createAndOpenFile(
  fileUri: vscode.Uri,
  content: string
): Promise<vscode.TextEditor> {
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content));
  const doc = await vscode.workspace.openTextDocument(fileUri);
  return await vscode.window.showTextDocument(doc);
}

/**
 * Modify file content and save
 */
export async function modifyAndSave(
  editor: vscode.TextEditor,
  newContent: string,
  waitMs: number = 1000
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length)
  );
  edit.replace(editor.document.uri, fullRange, newContent);
  
  await vscode.workspace.applyEdit(edit);
  await editor.document.save();
  await wait(waitMs);
}

/**
 * Delete file locally and remotely, and clear any ignored conflicts
 * 
 * CRITICAL: This clears ignored conflict flags because:
 * - vscode.workspace.fs.delete() does NOT trigger onDidDeleteFiles events
 * - SSH deletion does NOT trigger VS Code events
 * - Ignored conflicts persist in SyncStateManager across tests
 */
export async function cleanTestFile(
  fileUri: vscode.Uri,
  fileName: string,
  remoteVerifier: RemoteStateVerifier,
  services: Services,
  testWorkspace: vscode.WorkspaceFolder
): Promise<void> {
  // 1. Delete local file (programmatic - no events)
  try {
    await vscode.workspace.fs.delete(fileUri);
  } catch {
    // Ignore errors
  }
  
  // 2. Delete remote file (SSH - no events)
  try {
    await remoteVerifier.deleteFile(fileName);
  } catch {
    // Ignore errors
  }
  
  // 3. Clear any ignored conflict
  const workspaceId = getWorkspaceId(testWorkspace);
  const relPath = relFromAbs(testWorkspace.uri.fsPath, fileUri.fsPath);
  
  // Clear from ALL THREE snapshots
  services.state.applyLocal({
    workspaceId: workspaceId,
    type: 'delete',
    path: relPath
  });
  
  services.state.applyRemote({
    workspaceId: workspaceId,
    type: 'delete',
    path: relPath
  });
  
  // Clear from base snapshot too!
  services.state.applyBase({
    workspaceId: workspaceId,
    type: 'delete',
    path: relPath
  });

  if (services.state.isConflictIgnored(workspaceId, relPath)) {
    services.state.clearIgnoredConflict(workspaceId, relPath);
  }
}

export async function cleanAllTestFiles(remoteVerifier: RemoteStateVerifier): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  
  // Clean local .txt files
  const files = await vscode.workspace.findFiles('*.txt', '.livesync/**');
  for (const file of files) {
    try {
      await vscode.workspace.fs.delete(file);
    } catch (err) {
      // Ignore errors
    }
  }
  
  // Clean local test folders
  if (workspaceRoot) {
    try {
      const entries = await vscode.workspace.fs.readDirectory(workspaceRoot);
      for (const [name, type] of entries) {
        if (type === vscode.FileType.Directory) {
          // Delete folders used in tests
          if (name.startsWith('folder-') || name === 'moved' || name === 'subdir') {
            const folderUri = vscode.Uri.joinPath(workspaceRoot, name);
            try {
              await vscode.workspace.fs.delete(folderUri, { recursive: true });
            } catch (err) {
              // Ignore errors
            }
          }
        }
      }
    } catch (err) {
      // Ignore errors
    }
  }
  
  // Clean remote .txt files and test folders
  try {
    await remoteVerifier.executeCommand(
      'cd /home/centos/e2e-test-workspace && ' +
      'rm -f *.txt && ' +
      'rm -rf folder-* moved subdir'
    );
  } catch (err) {
    // Ignore errors
  }
  
  await wait(500);
}

// ==========================================================================
// Assertions
// ==========================================================================

/**
 * Get file status from diff tree
 */
export function getFileStatus(
  services: Services,
  testWorkspace: vscode.WorkspaceFolder,
  fileUri: vscode.Uri
): DiffStatus | undefined {
  const workspaceId = getWorkspaceId(testWorkspace);
  const relPath = relFromAbs(testWorkspace.uri.fsPath, fileUri.fsPath);
  return services.state.getDiffEntry(workspaceId, relPath)?.status;
}

/**
 * Assert file status
 */
export function assertFileStatus(
  services: Services,
  testWorkspace: vscode.WorkspaceFolder,
  fileUri: vscode.Uri,
  expectedStatus: DiffStatus,
  message?: string
): void {
  const actualStatus = getFileStatus(services, testWorkspace, fileUri);
  assert.strictEqual(
    actualStatus,
    expectedStatus,
    message || `File status should be "${expectedStatus}"`
  );
}

/**
 * Assert file exists/doesn't exist on remote
 */
export async function assertRemoteExists(
  remoteVerifier: RemoteStateVerifier,
  fileName: string,
  shouldExist: boolean,
  message?: string
): Promise<void> {
  const exists = await remoteVerifier.fileExists(fileName);
  assert.strictEqual(
    exists,
    shouldExist,
    message || `File should ${shouldExist ? '' : 'not '}exist on remote`
  );
}

/**
 * Assert remote file content
 */
export async function assertRemoteContent(
  remoteVerifier: RemoteStateVerifier,
  fileName: string,
  expectedContent: string,
  message?: string
): Promise<void> {
  const actualContent = await remoteVerifier.readFile(fileName);
  assert.strictEqual(
    actualContent.trim(),
    expectedContent,
    message || 'Remote content should match expected'
  );
}

/**
 * Assert file/folder exists/doesn't exist locally
 */
export async function assertLocalExists(
  fileUri: vscode.Uri,
  shouldExist: boolean,
  message?: string
): Promise<void> {
  let exists = false;
  try {
    await vscode.workspace.fs.stat(fileUri);
    exists = true;
  } catch {
    exists = false;
  }
  
  assert.strictEqual(
    exists,
    shouldExist,
    message || `File should ${shouldExist ? '' : 'not '}exist locally`
  );
}

/**
 * Assert local file content
 */
export async function assertLocalContent(
  fileUri: vscode.Uri,
  expectedContent: string,
  message?: string
): Promise<void> {
  const actualContent = await vscode.workspace.fs.readFile(fileUri);
  assert.strictEqual(
    actualContent.toString(),
    expectedContent,
    message || 'Local content should match expected'
  );
}

/**
 * Assert conflict is marked as ignored
 */
export function assertConflictIgnored(
  services: Services,
  testWorkspace: vscode.WorkspaceFolder,
  fileUri: vscode.Uri,
  shouldBeIgnored: boolean
): void {
  const workspaceId = getWorkspaceId(testWorkspace);
  const relPath = relFromAbs(testWorkspace.uri.fsPath, fileUri.fsPath);
  const isIgnored = services.state.isConflictIgnored(workspaceId, relPath);
  
  assert.strictEqual(
    isIgnored,
    shouldBeIgnored,
    `Conflict should ${shouldBeIgnored ? '' : 'not '}be marked as ignored`
  );
}

// ==========================================================================
// Utilities
// ==========================================================================

/**
 * Wait helper
 */
export async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Set test conflict response
 */
export async function setTestResponse(
  response: 'proceed' | 'cancel' | 'ignore' | null
): Promise<void> {
  await vscode.commands.executeCommand('livesync.test.setConflictResponse', response);
}

/**
 * Refresh extension
 */
export async function refresh(): Promise<void> {
  await vscode.commands.executeCommand('livesync.refresh');
  await wait(1000);
}