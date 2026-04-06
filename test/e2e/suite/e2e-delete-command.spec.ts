/**
 * E2E Tests - Delete Commands
 * Tests delete commands with various policies and scenarios
 * 
 * Test Structure:
 * 1. Delete File with Policies - 4 tests (none, delete, check, check&delete)
 * 2. Delete File Scenarios - 3 tests (local-only, remote-only, both)
 * 3. Delete Folder with Policies - 4 tests (none, delete, check, check&delete)
 * 4. Delete Folder Scenarios - 3 tests (local-only, remote-only, both)
 * 
 * Total: 14 tests
 */

import * as vscode from 'vscode';
import {
  setupE2ESuite,
  teardownE2ESuite,
  createAndOpenFile,
  assertFileStatus,
  assertRemoteExists,
  assertLocalExists,
  refresh,
  wait,
  type E2ETestContext,
  cleanAllTestFiles,
  createTestConfig
} from './e2e-shared-helpers';
import { RelPath, WorkspaceId } from '../../../src/domain/types';
import path from 'path';

suite('E2E - Delete Commands', function() {
  this.timeout(30000);

  const ctx: Partial<E2ETestContext> = {};
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
  // TYPES & CONSTANTS
  // ==========================================================================

  type Scenario = 'local-only' | 'remote-only' | 'both';
  type EntityType = 'file' | 'folder';
  type DeletePolicy = 'none' | 'delete' | 'check' | 'check&delete';

  interface TestEntity {
    type: EntityType;
    uri: vscode.Uri;
    remotePath: string;
    children?: { uri: vscode.Uri; remotePath: string }[];
  }

  interface ScenarioExpectations {
    localBefore: boolean;
    remoteBefore: boolean;
    statusBefore: 'added' | 'removed' | 'unchanged';
  }

  // ==========================================================================
  // ENTITY CREATION HELPERS
  // ==========================================================================

  /**
   * Create a test entity (file or folder)
   */
  function createTestEntity(name: string, type: EntityType): TestEntity {
    if (type === 'file') {
      const uri = vscode.Uri.joinPath(ctx.testWorkspace!.uri, name);
      return {
        type: 'file',
        uri,
        remotePath: name
      };
    } else {
      const folderUri = vscode.Uri.joinPath(ctx.testWorkspace!.uri, name);
      return {
        type: 'folder',
        uri: folderUri,
        remotePath: name,
        children: [
          {
            uri: vscode.Uri.joinPath(folderUri, 'file1.txt'),
            remotePath: `${name}/file1.txt`
          },
          {
            uri: vscode.Uri.joinPath(folderUri, 'file2.txt'),
            remotePath: `${name}/file2.txt`
          }
        ]
      };
    }
  }

  /**
   * Clean an entity (file or folder) - removes from filesystem, remote, AND state
   */
  async function cleanEntity(entity: TestEntity): Promise<void> {
    // Delete from filesystem
    try {
      await vscode.workspace.fs.delete(entity.uri, { recursive: true });
    } catch {
      // Ignore
    }

    // Delete from remote
    try {
      if (entity.type === 'file') {
        await ctx.remoteVerifier!.deleteFile(entity.remotePath);
      } else {
        await ctx.remoteVerifier!.deleteFolder(entity.remotePath);
      }
    } catch {
      // Ignore
    }

    // Clear from state snapshots (NEW!)
    if (ctx.services) {
      const wsId = ctx.testWorkspace!.uri.fsPath as WorkspaceId;
      
      if (entity.type === 'file') {
        const relPath = path.relative(ctx.testWorkspace!.uri.fsPath, entity.uri.fsPath) as RelPath;
        clearFromAllSnapshots(wsId, relPath);
      } else {
        // For folders, clear all children
        for (const child of entity.children!) {
          const relPath = path.relative(ctx.testWorkspace!.uri.fsPath, child.uri.fsPath) as RelPath;
          clearFromAllSnapshots(wsId, relPath);
        }
        
        // Also clear the folder itself
        const folderRelPath = path.relative(ctx.testWorkspace!.uri.fsPath, entity.uri.fsPath) as RelPath;
        clearFromAllSnapshots(wsId, folderRelPath);
      }
    }

    if (entity.type === 'folder') {
      await wait(2000);  // 2s for folders
    } else {
      await wait(500);   // 500ms for files
    }
  }

  /**
   * Helper: Clear a path from all three snapshots
   */
  function clearFromAllSnapshots(workspaceId: WorkspaceId, relPath: RelPath): void {
    ctx.services!.state.applyLocal({
      workspaceId,
      type: 'delete',
      path: relPath
    });
    
    ctx.services!.state.applyRemote({
      workspaceId,
      type: 'delete',
      path: relPath
    });
    
    ctx.services!.state.applyBase({
      workspaceId,
      type: 'delete',
      path: relPath
    });
  }

  /**
   * Create entity locally
   */
  async function createEntityLocally(entity: TestEntity): Promise<void> {
    if (entity.type === 'file') {
      await createAndOpenFile(entity.uri, fileContent);
    } else {
      await vscode.workspace.fs.createDirectory(entity.uri);
      for (const child of entity.children!) {
        await vscode.workspace.fs.writeFile(child.uri, Buffer.from(fileContent));
      }
    }
    await wait(1000);
  }

  /**
   * Create entity remotely
   */
  async function createEntityRemotely(entity: TestEntity): Promise<void> {
    if (entity.type === 'file') {
      await ctx.remoteVerifier!.createFile(entity.remotePath, fileContent);
    } else {
      for (const child of entity.children!) {
        await ctx.remoteVerifier!.createFile(child.remotePath, fileContent);
      }
    }
    await wait(1000);
  }

  /**
   * Upload entity
   */
  async function uploadEntity(entity: TestEntity): Promise<void> {
    const command = entity.type === 'file' ? 'livesync.upload' : 'livesync.uploadFolder';
    await vscode.commands.executeCommand(command, entity.uri);
    await wait(entity.type === 'file' ? 2000 : 3000);
  }

  // ==========================================================================
  // SCENARIO SETUP
  // ==========================================================================

  /**
   * Setup entity according to scenario
   */
  async function setupScenario(
    entity: TestEntity,
    scenario: Scenario
  ): Promise<ScenarioExpectations> {
    await cleanEntity(entity);
    
    switch (scenario) {
      case 'local-only':
        await createEntityLocally(entity);
        return { localBefore: true, remoteBefore: false, statusBefore: 'added' };

      case 'remote-only':
        await createEntityRemotely(entity);
        return { localBefore: false, remoteBefore: true, statusBefore: 'removed' };

      case 'both':
        await createEntityLocally(entity);
        await refresh(); // Ensure state is rebuilt from filesystem before uploading
        await uploadEntity(entity);
        return { localBefore: true, remoteBefore: true, statusBefore: 'unchanged' };
    }
  }

  // ==========================================================================
  // ASSERTION HELPERS
  // ==========================================================================

  /**
   * Assert entity state before deletion
   */
  async function assertEntityStateBefore(
    entity: TestEntity,
    expectations: ScenarioExpectations
  ): Promise<void> {
    await refresh();

    if (entity.type === 'file') {
      await assertLocalExists(entity.uri, expectations.localBefore, 
        `File should ${expectations.localBefore ? 'exist' : 'not exist'} locally`);
      await assertRemoteExists(ctx.remoteVerifier!, entity.remotePath, expectations.remoteBefore,
        `File should ${expectations.remoteBefore ? 'exist' : 'not exist'} remotely`);
      
      if (expectations.localBefore || expectations.remoteBefore) {
        await assertFileStatus(ctx.services!, ctx.testWorkspace!, entity.uri, expectations.statusBefore);
      }
    } else {
      for (const child of entity.children!) {
        await assertLocalExists(child.uri, expectations.localBefore,
          `Child file should ${expectations.localBefore ? 'exist' : 'not exist'} locally`);
        await assertRemoteExists(ctx.remoteVerifier!, child.remotePath, expectations.remoteBefore,
          `Child file should ${expectations.remoteBefore ? 'exist' : 'not exist'} remotely`);
        
        if (expectations.localBefore || expectations.remoteBefore) {
          await assertFileStatus(ctx.services!, ctx.testWorkspace!, child.uri, expectations.statusBefore);
        }
      }
    }
  }

  /**
   * Assert entity state after deletion
   */
  async function assertEntityStateAfter(
    entity: TestEntity,
    shouldExistLocal: boolean,
    shouldExistRemote: boolean
  ): Promise<void> {
    if (entity.type === 'file') {
      await assertLocalExists(entity.uri, shouldExistLocal,
        `File should ${shouldExistLocal ? 'exist' : 'be deleted'} locally`);
      await assertRemoteExists(ctx.remoteVerifier!, entity.remotePath, shouldExistRemote,
        `File should ${shouldExistRemote ? 'exist' : 'be deleted'} remotely`);
    } else {
      await assertLocalExists(entity.uri, shouldExistLocal,
        `Folder should ${shouldExistLocal ? 'exist' : 'be deleted'} locally`);
      
      for (const child of entity.children!) {
        await assertLocalExists(child.uri, shouldExistLocal,
          `Child file should ${shouldExistLocal ? 'exist' : 'be deleted'} locally`);
        await assertRemoteExists(ctx.remoteVerifier!, child.remotePath, shouldExistRemote,
          `Child file should ${shouldExistRemote ? 'exist' : 'be deleted'} remotely`);
      }
    }
  }

  // ==========================================================================
  // UNIFIED TEST HELPER
  // ==========================================================================

  /**
   * Test delete behavior with given policy and scenario
   */
  async function testDelete(
    name: string,
    type: EntityType,
    policy: DeletePolicy,
    scenario: Scenario,
    expectedLocalAfter: boolean,
    expectedRemoteAfter: boolean
  ): Promise<void> {
    const entity = createTestEntity(name, type);

    // Setup config with policy
    ctx.configPath = await createTestConfig(ctx.testWorkspace!, {
      actionOnDelete: policy
    });

    // Setup scenario
    const expectations = await setupScenario(entity, scenario);

    // Assert state before
    await assertEntityStateBefore(entity, expectations);

    // Execute delete command
    const command = type === 'file' ? 'livesync.delete' : 'livesync.deleteFolder';
    await vscode.commands.executeCommand(command, entity.uri);
    await wait(2000);

    // Assert state after
    await assertEntityStateAfter(entity, expectedLocalAfter, expectedRemoteAfter);
  }

  // ==========================================================================
  // FILE POLICY TESTS
  // ==========================================================================

  test('Delete File with actionOnDelete=none - no deletion', async () => {
    await testDelete(
      'delete-file-none.txt',
      'file',
      'none',
      'both',
      true,  // File stays locally
      true   // File stays remotely
    );
  });

  test('Delete File with actionOnDelete=delete - direct delete without check', async () => {
    await testDelete(
      'delete-file-delete.txt',
      'file',
      'delete',
      'both',
      false, // File deleted locally
      false  // File deleted remotely
    );
  });

  test('Delete File with actionOnDelete=check - check only, no delete', async () => {
    await testDelete(
      'delete-file-check.txt',
      'file',
      'check',
      'both',
      true,  // File stays locally
      true   // File stays remotely
    );
  });

  test('Delete File with actionOnDelete=check&delete - delete after check', async () => {
    await testDelete(
      'delete-file-check-delete.txt',
      'file',
      'check&delete',
      'both',
      false, // File deleted locally
      false  // File deleted remotely
    );
  });

  // ==========================================================================
  // FILE SCENARIO TESTS
  // ==========================================================================

  test('Delete File (Local Only) - removes only local file', async () => {
    await testDelete(
      'delete-local-only.txt',
      'file',
      'delete',
      'local-only',
      false, // Local deleted
      false  // Remote never existed
    );
  });

  test('Delete File (Remote Only) - removes only remote file', async () => {
    await testDelete(
      'delete-remote-only.txt',
      'file',
      'delete',
      'remote-only',
      false, // Local never existed
      false  // Remote deleted
    );
  });

  test('Delete File (Both) - removes from both sides', async () => {
    await testDelete(
      'delete-both.txt',
      'file',
      'delete',
      'both',
      false, // Local deleted
      false  // Remote deleted
    );
  });

  // ==========================================================================
  // FOLDER POLICY TESTS
  // ==========================================================================

  test('Delete Folder with actionOnDelete=none - no deletion', async () => {
    await testDelete(
      'delete-folder-none',
      'folder',
      'none',
      'both',
      true,  // Folder stays locally
      true   // Folder stays remotely
    );
  });

  test('Delete Folder with actionOnDelete=delete - direct delete without check', async () => {
    await testDelete(
      'delete-folder-delete',
      'folder',
      'delete',
      'both',
      false, // Folder deleted locally
      false  // Folder deleted remotely
    );
  });

  test('Delete Folder with actionOnDelete=check - check only, no delete', async () => {
    await testDelete(
      'delete-folder-check',
      'folder',
      'check',
      'both',
      true,  // Folder stays locally
      true   // Folder stays remotely
    );
  });

  test('Delete Folder with actionOnDelete=check&delete - delete after check', async () => {
    await testDelete(
      'delete-folder-check-delete',
      'folder',
      'check&delete',
      'both',
      false, // Folder deleted locally
      false  // Folder deleted remotely
    );
  });

  // ==========================================================================
  // FOLDER SCENARIO TESTS
  // ==========================================================================

  test('Delete Folder (Local Only) - removes only local folder', async () => {
    await testDelete(
      'delete-folder-local-only',
      'folder',
      'delete',
      'local-only',
      false, // Local deleted
      false  // Remote never existed
    );
  });

  test('Delete Folder (Remote Only) - removes only remote folder', async () => {
    await testDelete(
      'delete-folder-remote-only',
      'folder',
      'delete',
      'remote-only',
      false, // Local never existed
      false  // Remote deleted
    );
  });

  test('Delete Folder (Both) - removes from both sides', async () => {
    await testDelete(
      'delete-folder-both',
      'folder',
      'delete',
      'both',
      false, // Local deleted
      false  // Remote deleted
    );
  });
});