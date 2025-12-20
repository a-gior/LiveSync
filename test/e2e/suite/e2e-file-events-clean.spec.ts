/**
 * E2E Tests - File Events
 * Tests that file system events trigger proper sync operations
 */

import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { Client as SSHClient } from 'ssh2';
import {
  createTestWorkspace,
  createLiveSyncConfig,
  createTestFile,
  modifyAndSaveFile,
  waitForExtension,
  cleanupTestWorkspace,
  E2E_VM_CONFIG,
  testConnection,
} from './helpers';

describe('E2E - File Events', function() {
  this.timeout(60000);

  let workspacePath: string;
  let workspaceFolder: vscode.WorkspaceFolder;

  before(async function() {
    // Check VM accessibility
    const connectionTest = await testConnection(E2E_VM_CONFIG);
    if (!connectionTest.success) {
      console.log('⚠️  VM not accessible - skipping file event tests');
      this.skip();
    }

    // Clean remote directory
    await cleanupRemotePath(E2E_VM_CONFIG.remotePath);
  });

  beforeEach(async function() {
    // Create fresh test workspace
    workspacePath = await createTestWorkspace(`events-${Date.now()}`);
    
    // Create LiveSync config
    await createLiveSyncConfig(workspacePath, {
      ...E2E_VM_CONFIG,
      actionOnSave: 'upload',
      actionOnCreate: 'upload',
      actionOnDelete: 'delete',
      actionOnMove: 'upload',
    });
    
    // Add workspace to VSCode
    const uri = vscode.Uri.file(workspacePath);
    const success = vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders?.length || 0,
      0,
      { uri, name: `test-${Date.now()}` }
    );
    
    if (!success) {
      throw new Error('Failed to add workspace');
    }
    
    // Wait for extension to detect new workspace
    await waitForExtension(2000);
    
    workspaceFolder = vscode.workspace.workspaceFolders![vscode.workspace.workspaceFolders!.length - 1];
    console.log(`\n  Workspace: ${workspaceFolder.name} (${workspacePath})`);
  });

  afterEach(async function() {
    // Remove workspace
    if (workspaceFolder) {
      const idx = vscode.workspace.workspaceFolders?.findIndex(
        f => f.uri.fsPath === workspacePath
      );
      if (idx !== undefined && idx >= 0) {
        vscode.workspace.updateWorkspaceFolders(idx, 1);
        await waitForExtension(500);
      }
    }
    
    await cleanupTestWorkspace(workspacePath);
    await cleanupRemotePath(E2E_VM_CONFIG.remotePath);
  });

  describe('File Save Events', () => {
    it('triggers upload on file save', async function() {
      // Create file
      const testFile = await createTestFile(workspacePath, 'test.txt', 'Initial content');
      console.log(`  Created: test.txt`);
      
      // Open in editor and modify
      await modifyAndSaveFile(testFile, 'Modified content');
      console.log(`  Saved: test.txt`);
      
      // Wait for sync
      await waitForExtension(3000);
      
      // Verify uploaded to remote
      const exists = await checkRemoteFile(E2E_VM_CONFIG, 'test.txt');
      const content = await getRemoteContent(E2E_VM_CONFIG, 'test.txt');
      
      console.log(`  Remote exists: ${exists}`);
      console.log(`  Remote content: "${content}"`);
      
      assert.ok(exists, 'File should exist on remote');
      assert.equal(content, 'Modified content', 'Remote content should match');
    });

    it('uploads nested files with parent directories', async function() {
      // Create nested file
      const testFile = await createTestFile(
        workspacePath,
        'folder/subfolder/nested.txt',
        'Nested content'
      );
      console.log(`  Created: folder/subfolder/nested.txt`);
      
      // Save it
      await modifyAndSaveFile(testFile, 'Nested content');
      console.log(`  Saved: folder/subfolder/nested.txt`);
      
      await waitForExtension(3000);
      
      // Verify remote structure
      const exists = await checkRemoteFile(E2E_VM_CONFIG, 'folder/subfolder/nested.txt');
      console.log(`  Remote exists: ${exists}`);
      
      assert.ok(exists, 'Nested file should exist on remote');
    });

    it('uploads multiple files in sequence', async function() {
      // Create and save multiple files
      const files = ['file1.txt', 'file2.txt', 'file3.txt'];
      
      for (const filename of files) {
        const filePath = await createTestFile(workspacePath, filename, `Content of ${filename}`);
        await modifyAndSaveFile(filePath, `Content of ${filename}`);
        console.log(`  Saved: ${filename}`);
        await waitForExtension(1000);
      }
      
      // Wait for all to sync
      await waitForExtension(3000);
      
      // Verify all uploaded
      for (const filename of files) {
        const exists = await checkRemoteFile(E2E_VM_CONFIG, filename);
        console.log(`  Remote ${filename}: ${exists ? '✓' : '✗'}`);
        assert.ok(exists, `${filename} should exist on remote`);
      }
    });
  });

  describe('File Create Events', () => {
    it('detects new file creation', async function() {
      // Create file using VSCode API (simulates user creating file)
      const fileUri = vscode.Uri.file(path.join(workspacePath, 'new-file.txt'));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from('New file content'));
      console.log(`  Created: new-file.txt (via VSCode API)`);
      
      // Wait for file watcher to detect
      await waitForExtension(3000);
      
      // Verify uploaded
      const exists = await checkRemoteFile(E2E_VM_CONFIG, 'new-file.txt');
      console.log(`  Remote exists: ${exists}`);
      
      assert.ok(exists, 'New file should be uploaded');
    });
  });

  describe('File Delete Events', () => {
    it('detects file deletion', async function() {
      // Create and upload file first
      const testFile = await createTestFile(workspacePath, 'to-delete.txt', 'Delete me');
      await modifyAndSaveFile(testFile, 'Delete me');
      await waitForExtension(2000);
      
      // Verify it's on remote
      let exists = await checkRemoteFile(E2E_VM_CONFIG, 'to-delete.txt');
      assert.ok(exists, 'File should exist before deletion');
      console.log(`  Remote before delete: exists`);
      
      // Delete file using VSCode API
      const fileUri = vscode.Uri.file(testFile);
      await vscode.workspace.fs.delete(fileUri);
      console.log(`  Deleted: to-delete.txt`);
      
      // Wait for sync
      await waitForExtension(3000);
      
      // Verify deleted from remote
      exists = await checkRemoteFile(E2E_VM_CONFIG, 'to-delete.txt');
      console.log(`  Remote after delete: ${exists ? 'still exists' : 'deleted'}`);
      
      assert.ok(!exists, 'File should be deleted from remote');
    });
  });

  describe('File Rename Events', () => {
    it('detects file rename/move', async function() {
      // Create and upload file
      const testFile = await createTestFile(workspacePath, 'old-name.txt', 'Content');
      await modifyAndSaveFile(testFile, 'Content');
      await waitForExtension(2000);
      
      // Verify original exists
      let oldExists = await checkRemoteFile(E2E_VM_CONFIG, 'old-name.txt');
      assert.ok(oldExists, 'Original file should exist');
      console.log(`  Remote old-name.txt: exists`);
      
      // Rename using VSCode API
      const oldUri = vscode.Uri.file(testFile);
      const newUri = vscode.Uri.file(path.join(workspacePath, 'new-name.txt'));
      await vscode.workspace.fs.rename(oldUri, newUri);
      console.log(`  Renamed: old-name.txt → new-name.txt`);
      
      // Wait for sync
      await waitForExtension(3000);
      
      // Verify rename on remote
      oldExists = await checkRemoteFile(E2E_VM_CONFIG, 'old-name.txt');
      const newExists = await checkRemoteFile(E2E_VM_CONFIG, 'new-name.txt');
      
      console.log(`  Remote old-name.txt: ${oldExists ? 'still exists' : 'gone'}`);
      console.log(`  Remote new-name.txt: ${newExists ? 'exists' : 'missing'}`);
      
      assert.ok(!oldExists, 'Old file should not exist on remote');
      assert.ok(newExists, 'New file should exist on remote');
    });
  });

  describe('Large File Handling', () => {
    it('uploads large file (1MB)', async function() {
      this.timeout(30000);
      
      // Create 1MB file
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB
      const testFile = await createTestFile(workspacePath, 'large-file.txt', largeContent);
      console.log(`  Created: large-file.txt (1MB)`);
      
      await modifyAndSaveFile(testFile, largeContent);
      console.log(`  Saved: large-file.txt`);
      
      // Wait longer for large file
      await waitForExtension(5000);
      
      const exists = await checkRemoteFile(E2E_VM_CONFIG, 'large-file.txt');
      console.log(`  Remote exists: ${exists}`);
      
      assert.ok(exists, 'Large file should be uploaded');
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

async function checkRemoteFile(config: typeof E2E_VM_CONFIG, relativePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new SSHClient();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.end();
        resolve(false);
      }
    }, 5000);

    client
      .on('ready', () => {
        const remotePath = `${config.remotePath}/${relativePath}`;
        client.exec(`test -f "${remotePath}" && echo "exists" || echo "missing"`, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            client.end();
            if (!resolved) {
              resolved = true;
              resolve(false);
            }
            return;
          }

          let output = '';
          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });
          stream.on('exit', () => {
            clearTimeout(timeout);
            client.end();
            if (!resolved) {
              resolved = true;
              resolve(output.trim() === 'exists');
            }
          });
        });
      })
      .on('error', () => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      })
      .connect({
        host: config.hostname,
        port: config.port,
        username: config.username,
        password: config.password,
      });
  });
}

async function getRemoteContent(config: typeof E2E_VM_CONFIG, relativePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();

    client
      .on('ready', () => {
        const remotePath = `${config.remotePath}/${relativePath}`;
        client.exec(`cat "${remotePath}"`, (err, stream) => {
          if (err) {
            client.end();
            return reject(err);
          }

          let output = '';
          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });
          stream.on('exit', () => {
            client.end();
            resolve(output);
          });
        });
      })
      .on('error', reject)
      .connect({
        host: config.hostname,
        port: config.port,
        username: config.username,
        password: config.password,
      });
  });
}

async function cleanupRemotePath(remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.end();
        reject(new Error('Cleanup timeout'));
      }
    }, 10000);

    client
      .on('ready', () => {
        client.exec(`rm -rf "${remotePath}" && mkdir -p "${remotePath}"`, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            client.end();
            if (!resolved) {
              resolved = true;
              reject(err);
            }
            return;
          }

          stream.on('exit', () => {
            clearTimeout(timeout);
            client.end();
            if (!resolved) {
              resolved = true;
              resolve();
            }
          });
        });
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      })
      .connect({
        host: E2E_VM_CONFIG.hostname,
        port: E2E_VM_CONFIG.port,
        username: E2E_VM_CONFIG.username,
        password: E2E_VM_CONFIG.password,
      });
  });
}