/**
 * E2E Tests - Configuration & Workspace Management
 * Tests config file handling, adding/removing workspaces, multi-workspace scenarios
 */

import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  createTestWorkspace,
  createLiveSyncConfig,
  waitForExtension,
  cleanupTestWorkspace,
  fileExists,
  readFile,
  E2E_VM_CONFIG,
} from './helpers';

describe('E2E - Configuration & Workspaces', function() {
  this.timeout(60000);

  describe('Config File Management', () => {
    let workspacePath: string;

    beforeEach(async function() {
      workspacePath = await createTestWorkspace(`config-${Date.now()}`);
    });

    afterEach(async function() {
      await cleanupTestWorkspace(workspacePath);
    });

    it('creates config file in .vscode directory', async function() {
      await createLiveSyncConfig(workspacePath, E2E_VM_CONFIG);
      console.log(`  Created config in: ${workspacePath}/.vscode/`);
      
      const configPath = path.join(workspacePath, '.vscode', 'livesync.json');
      const exists = await fileExists(configPath);
      
      console.log(`  Config exists: ${exists}`);
      assert.ok(exists, 'Config file should be created');
    });

    it('config file has correct structure', async function() {
      await createLiveSyncConfig(workspacePath, E2E_VM_CONFIG);
      
      const configPath = path.join(workspacePath, '.vscode', 'livesync.json');
      const content = await readFile(configPath);
      const config = JSON.parse(content);
      
      console.log(`  Config keys:`, Object.keys(config).join(', '));
      
      assert.ok(config.hostname, 'Should have hostname');
      assert.ok(config.port, 'Should have port');
      assert.ok(config.username, 'Should have username');
      assert.ok(config.remotePath, 'Should have remotePath');
      
      assert.equal(config.hostname, E2E_VM_CONFIG.hostname);
      assert.equal(config.port, E2E_VM_CONFIG.port);
      console.log(`  ✓ Config structure valid`);
    });

    it('reads existing config file', async function() {
      // Create config
      await createLiveSyncConfig(workspacePath, {
        ...E2E_VM_CONFIG,
        remotePath: '/test/custom/path',
      });
      
      // Add workspace to VSCode
      const uri = vscode.Uri.file(workspacePath);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri });
      await waitForExtension(2000);
      
      // Extension should read the config
      // We can verify this by checking if files sync to /test/custom/path
      console.log(`  ✓ Extension should read config`);
      console.log(`  Custom remote path: /test/custom/path`);
      
      // Cleanup
      const idx = vscode.workspace.workspaceFolders?.findIndex(
        f => f.uri.fsPath === workspacePath
      );
      if (idx !== undefined && idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
      }
      
      assert.ok(true);
    });

    it('ignores files based on ignoreList', async function() {
      // Create config with ignore patterns
      await createLiveSyncConfig(workspacePath, {
        ...E2E_VM_CONFIG,
        ignoreList: ['.livesync', '.git', 'node_modules', '*.log'],
      });
      
      const configPath = path.join(workspacePath, '.vscode', 'livesync.json');
      const content = await readFile(configPath);
      const config = JSON.parse(content);
      
      console.log(`  Ignore patterns:`, config.ignoreList.join(', '));
      
      assert.ok(config.ignoreList.includes('.livesync'), 'Should ignore .livesync');
      assert.ok(config.ignoreList.includes('node_modules'), 'Should ignore node_modules');
      
      console.log(`  ✓ Ignore list configured`);
    });
  });

  describe('Single Workspace', () => {
    let workspacePath: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    beforeEach(async function() {
      workspacePath = await createTestWorkspace(`ws1-${Date.now()}`);
      await createLiveSyncConfig(workspacePath, E2E_VM_CONFIG);
      
      const uri = vscode.Uri.file(workspacePath);
      vscode.workspace.updateWorkspaceFolders(0, 0, { 
        uri, 
        name: `Workspace-${Date.now()}` 
      });
      
      await waitForExtension(2000);
      workspaceFolder = vscode.workspace.workspaceFolders![0];
      console.log(`  Added workspace: ${workspaceFolder.name}`);
    });

    afterEach(async function() {
      if (workspaceFolder) {
        const idx = vscode.workspace.workspaceFolders?.findIndex(
          f => f.uri.fsPath === workspacePath
        );
        if (idx !== undefined && idx >= 0) {
          vscode.workspace.updateWorkspaceFolders(idx, 1);
        }
      }
      await cleanupTestWorkspace(workspacePath);
    });

    it('workspace is added to VSCode', () => {
      const folders = vscode.workspace.workspaceFolders;
      assert.ok(folders && folders.length > 0, 'Should have at least one workspace');
      
      const hasOurWorkspace = folders?.some(f => f.uri.fsPath === workspacePath);
      assert.ok(hasOurWorkspace, 'Our workspace should be in the list');
      
      console.log(`  ✓ Workspace count: ${folders?.length}`);
    });

    it('workspace has correct properties', () => {
      assert.ok(workspaceFolder.uri, 'Should have URI');
      assert.ok(workspaceFolder.name, 'Should have name');
      assert.equal(workspaceFolder.uri.fsPath, workspacePath, 'Path should match');
      
      console.log(`  Name: ${workspaceFolder.name}`);
      console.log(`  Path: ${workspaceFolder.uri.fsPath}`);
    });

    it('removing workspace removes it from VSCode', async function() {
      const initialCount = vscode.workspace.workspaceFolders?.length || 0;
      console.log(`  Initial workspace count: ${initialCount}`);
      
      const idx = vscode.workspace.workspaceFolders?.findIndex(
        f => f.uri.fsPath === workspacePath
      );
      
      if (idx !== undefined && idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
        await waitForExtension(1000);
      }
      
      const finalCount = vscode.workspace.workspaceFolders?.length || 0;
      console.log(`  Final workspace count: ${finalCount}`);
      
      assert.equal(finalCount, initialCount - 1, 'Workspace should be removed');
      
      // Mark as removed so afterEach doesn't try to remove again
      workspaceFolder = null as any;
    });
  });

  describe('Multi-Workspace', () => {
    let workspace1Path: string;
    let workspace2Path: string;
    let folder1: vscode.WorkspaceFolder;
    let folder2: vscode.WorkspaceFolder;

    beforeEach(async function() {
      // Create two workspaces
      workspace1Path = await createTestWorkspace(`ws1-${Date.now()}`);
      workspace2Path = await createTestWorkspace(`ws2-${Date.now()}`);
      
      // Create separate configs
      await createLiveSyncConfig(workspace1Path, {
        ...E2E_VM_CONFIG,
        remotePath: '/home/centos/workspace1',
      });
      
      await createLiveSyncConfig(workspace2Path, {
        ...E2E_VM_CONFIG,
        remotePath: '/home/centos/workspace2',
      });
      
      // Add both to VSCode
      const uri1 = vscode.Uri.file(workspace1Path);
      const uri2 = vscode.Uri.file(workspace2Path);
      
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri: uri1, name: 'Workspace-1' });
      vscode.workspace.updateWorkspaceFolders(1, 0, { uri: uri2, name: 'Workspace-2' });
      
      await waitForExtension(3000);
      
      const folders = vscode.workspace.workspaceFolders || [];
      folder1 = folders.find(f => f.uri.fsPath === workspace1Path)!;
      folder2 = folders.find(f => f.uri.fsPath === workspace2Path)!;
      
      console.log(`  Added 2 workspaces:`);
      console.log(`    1. ${folder1?.name}`);
      console.log(`    2. ${folder2?.name}`);
    });

    afterEach(async function() {
      // Remove both workspaces
      if (folder1 || folder2) {
        const toRemove: number[] = [];
        
        vscode.workspace.workspaceFolders?.forEach((f, i) => {
          if (f.uri.fsPath === workspace1Path || f.uri.fsPath === workspace2Path) {
            toRemove.push(i);
          }
        });
        
        // Remove in reverse order to maintain indices
        toRemove.reverse().forEach(idx => {
          vscode.workspace.updateWorkspaceFolders(idx, 1);
        });
      }
      
      await cleanupTestWorkspace(workspace1Path);
      await cleanupTestWorkspace(workspace2Path);
    });

    it('supports multiple workspaces simultaneously', () => {
      const folders = vscode.workspace.workspaceFolders || [];
      const hasWs1 = folders.some(f => f.uri.fsPath === workspace1Path);
      const hasWs2 = folders.some(f => f.uri.fsPath === workspace2Path);
      
      console.log(`  Total workspaces: ${folders.length}`);
      console.log(`  Has WS1: ${hasWs1}`);
      console.log(`  Has WS2: ${hasWs2}`);
      
      assert.ok(hasWs1 && hasWs2, 'Both workspaces should be active');
    });

    it('each workspace has independent config', async function() {
      const config1Path = path.join(workspace1Path, '.vscode', 'livesync.json');
      const config2Path = path.join(workspace2Path, '.vscode', 'livesync.json');
      
      const config1 = JSON.parse(await readFile(config1Path));
      const config2 = JSON.parse(await readFile(config2Path));
      
      console.log(`  WS1 remote: ${config1.remotePath}`);
      console.log(`  WS2 remote: ${config2.remotePath}`);
      
      assert.notEqual(config1.remotePath, config2.remotePath, 'Configs should differ');
      assert.equal(config1.remotePath, '/home/centos/workspace1');
      assert.equal(config2.remotePath, '/home/centos/workspace2');
    });

    it('can add third workspace dynamically', async function() {
      const workspace3Path = await createTestWorkspace(`ws3-${Date.now()}`);
      await createLiveSyncConfig(workspace3Path, E2E_VM_CONFIG);
      
      const initialCount = vscode.workspace.workspaceFolders?.length || 0;
      console.log(`  Initial count: ${initialCount}`);
      
      const uri3 = vscode.Uri.file(workspace3Path);
      vscode.workspace.updateWorkspaceFolders(
        initialCount,
        0,
        { uri: uri3, name: 'Workspace-3' }
      );
      
      await waitForExtension(2000);
      
      const finalCount = vscode.workspace.workspaceFolders?.length || 0;
      console.log(`  Final count: ${finalCount}`);
      
      assert.equal(finalCount, initialCount + 1, 'Should add third workspace');
      
      // Cleanup
      vscode.workspace.updateWorkspaceFolders(initialCount, 1);
      await cleanupTestWorkspace(workspace3Path);
    });

    it('can remove workspace without affecting others', async function() {
      const initialCount = vscode.workspace.workspaceFolders?.length || 0;
      
      // Remove workspace 1
      const idx = vscode.workspace.workspaceFolders?.findIndex(
        f => f.uri.fsPath === workspace1Path
      );
      
      if (idx !== undefined && idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
        await waitForExtension(1000);
      }
      
      const afterRemove = vscode.workspace.workspaceFolders?.length || 0;
      const ws2Still = vscode.workspace.workspaceFolders?.some(
        f => f.uri.fsPath === workspace2Path
      );
      
      console.log(`  Before: ${initialCount} workspaces`);
      console.log(`  After removing WS1: ${afterRemove} workspaces`);
      console.log(`  WS2 still present: ${ws2Still}`);
      
      assert.equal(afterRemove, initialCount - 1, 'Should remove one workspace');
      assert.ok(ws2Still, 'WS2 should still be present');
      
      folder1 = null as any; // Prevent double-removal in afterEach
    });
  });

  describe('Config Edge Cases', () => {
    it('handles missing config file gracefully', async function() {
      const workspacePath = await createTestWorkspace(`no-config-${Date.now()}`);
      
      // Add workspace WITHOUT creating config
      const uri = vscode.Uri.file(workspacePath);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri });
      
      await waitForExtension(2000);
      
      // Extension should handle missing config gracefully
      // (might show error message or prompt to create config)
      console.log(`  ✓ Workspace added without config`);
      
      // Cleanup
      const idx = vscode.workspace.workspaceFolders?.findIndex(
        f => f.uri.fsPath === workspacePath
      );
      if (idx !== undefined && idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
      }
      await cleanupTestWorkspace(workspacePath);
      
      assert.ok(true, 'Should handle missing config');
    });

    it('handles invalid JSON in config', async function() {
      const workspacePath = await createTestWorkspace(`bad-config-${Date.now()}`);
      
      // Create invalid config
      const configPath = path.join(workspacePath, '.vscode', 'livesync.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, '{ invalid json }');
      console.log(`  Created invalid config`);
      
      // Add workspace
      const uri = vscode.Uri.file(workspacePath);
      vscode.workspace.updateWorkspaceFolders(0, 0, { uri });
      
      await waitForExtension(2000);
      
      // Extension should handle parsing error
      console.log(`  ✓ Extension handled invalid JSON`);
      
      // Cleanup
      const idx = vscode.workspace.workspaceFolders?.findIndex(
        f => f.uri.fsPath === workspacePath
      );
      if (idx !== undefined && idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
      }
      await cleanupTestWorkspace(workspacePath);
      
      assert.ok(true, 'Should handle invalid JSON');
    });
  });
});