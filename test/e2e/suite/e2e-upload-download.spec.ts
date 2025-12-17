/**
 * E2E Tests - Upload/Download Operations
 * Tests manual and automatic sync of files and folders
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
  readFile,
  fileExists,
  E2E_VM_CONFIG,
} from './helpers';

describe('E2E - Upload/Download Operations', function() {
  this.timeout(60000);

  let workspacePath: string;
  let workspaceFolder: vscode.WorkspaceFolder;

  before(async function() {
    const vmOk = await isVMAccessible();
    if (!vmOk) {
      console.log('⚠️  VM not accessible - skipping upload/download tests');
      this.skip();
    }

    await cleanupRemotePath(E2E_VM_CONFIG.remotePath);
  });

  beforeEach(async function() {
    workspacePath = await createTestWorkspace(`sync-${Date.now()}`);
    
    await createLiveSyncConfig(workspacePath, {
      ...E2E_VM_CONFIG,
      actionOnSave: 'upload',
      actionOnOpen: 'download',
    });
    
    const uri = vscode.Uri.file(workspacePath);
    vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders?.length || 0,
      0,
      { uri, name: `sync-${Date.now()}` }
    );
    
    await waitForExtension(2000);
    workspaceFolder = vscode.workspace.workspaceFolders![vscode.workspace.workspaceFolders!.length - 1];
    console.log(`\n  Workspace: ${workspacePath}`);
  });

  afterEach(async function() {
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

  describe('Single File Upload', () => {
    it('uploads single file on save', async function() {
      console.log(`  Test: uploads single file on save`);
      const testFile = await createTestFile(workspacePath, 'upload-test.txt', 'Upload content');
      console.log(`  Created: upload-test.txt`);
      
      await modifyAndSaveFile(testFile, 'Upload content');
      console.log(`  Saved → Upload triggered`);
      
      await waitForExtension(3000);
      
      const exists = await checkRemoteFile(E2E_VM_CONFIG, 'upload-test.txt');
      const content = await getRemoteContent(E2E_VM_CONFIG, 'upload-test.txt');
      
      console.log(`  Remote: ${exists ? 'exists' : 'missing'}`);
      console.log(`  Content: "${content}"`);
      
      assert.ok(exists, 'File should be uploaded');
      assert.equal(content, 'Upload content', 'Content should match');
    });

    it('uploads file with special characters', async function() {
      const testFile = await createTestFile(
        workspacePath,
        'special-chars (test) [file].txt',
        'Special content'
      );
      console.log(`  Created: special-chars (test) [file].txt`);
      
      await modifyAndSaveFile(testFile, 'Special content');
      await waitForExtension(3000);
      
      const exists = await checkRemoteFile(E2E_VM_CONFIG, 'special-chars (test) [file].txt');
      console.log(`  Remote: ${exists ? 'exists' : 'missing'}`);
      
      assert.ok(exists, 'File with special chars should upload');
    });
  });

  describe('Folder Upload', () => {
    it('uploads entire folder structure', async function() {
      // Create folder structure
      await createTestFile(workspacePath, 'folder/file1.txt', 'File 1');
      await createTestFile(workspacePath, 'folder/file2.txt', 'File 2');
      await createTestFile(workspacePath, 'folder/subfolder/file3.txt', 'File 3');
      console.log(`  Created folder structure:`);
      console.log(`    folder/file1.txt`);
      console.log(`    folder/file2.txt`);
      console.log(`    folder/subfolder/file3.txt`);
      
      // Save all files
      await modifyAndSaveFile(path.join(workspacePath, 'folder/file1.txt'), 'File 1');
      await modifyAndSaveFile(path.join(workspacePath, 'folder/file2.txt'), 'File 2');
      await modifyAndSaveFile(path.join(workspacePath, 'folder/subfolder/file3.txt'), 'File 3');
      console.log(`  Saved all files`);
      
      await waitForExtension(5000);
      
      // Verify all uploaded
      const file1 = await checkRemoteFile(E2E_VM_CONFIG, 'folder/file1.txt');
      const file2 = await checkRemoteFile(E2E_VM_CONFIG, 'folder/file2.txt');
      const file3 = await checkRemoteFile(E2E_VM_CONFIG, 'folder/subfolder/file3.txt');
      
      console.log(`  Remote structure:`);
      console.log(`    folder/file1.txt: ${file1 ? '✓' : '✗'}`);
      console.log(`    folder/file2.txt: ${file2 ? '✓' : '✗'}`);
      console.log(`    folder/subfolder/file3.txt: ${file3 ? '✓' : '✗'}`);
      
      assert.ok(file1 && file2 && file3, 'All files should be uploaded');
    });

    it('uploads nested folders (3 levels deep)', async function() {
      await createTestFile(workspacePath, 'level1/level2/level3/deep.txt', 'Deep file');
      console.log(`  Created: level1/level2/level3/deep.txt`);
      
      await modifyAndSaveFile(
        path.join(workspacePath, 'level1/level2/level3/deep.txt'),
        'Deep file'
      );
      
      await waitForExtension(3000);
      
      const exists = await checkRemoteFile(E2E_VM_CONFIG, 'level1/level2/level3/deep.txt');
      console.log(`  Remote: ${exists ? 'exists' : 'missing'}`);
      
      assert.ok(exists, 'Deeply nested file should upload');
    });
  });

  describe('Single File Download', () => {
    it('downloads file when opening', async function() {
      // Create file on remote first
      const remoteContent = 'Remote content for download';
      await createRemoteFile(E2E_VM_CONFIG, 'download-test.txt', remoteContent);
      console.log(`  Created on remote: download-test.txt`);
      
      // Create empty local file
      const localFile = path.join(workspacePath, 'download-test.txt');
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(localFile),
        Buffer.from('') // Empty
      );
      console.log(`  Created empty local: download-test.txt`);
      
      // Open file (should trigger download)
      const doc = await vscode.workspace.openTextDocument(localFile);
      await vscode.window.showTextDocument(doc);
      console.log(`  Opened file → Download triggered`);
      
      await waitForExtension(3000);
      
      // Read local content
      const localContent = await readFile(localFile);
      console.log(`  Local content: "${localContent}"`);
      
      assert.equal(localContent, remoteContent, 'File should be downloaded');
    });

    it('overwrites local file with remote version', async function() {
      // Create different content on local and remote
      const localFile = await createTestFile(workspacePath, 'overwrite.txt', 'Local version');
      await createRemoteFile(E2E_VM_CONFIG, 'overwrite.txt', 'Remote version');
      console.log(`  Local: "Local version"`);
      console.log(`  Remote: "Remote version"`);
      
      // Open file (download should overwrite)
      const doc = await vscode.workspace.openTextDocument(localFile);
      await vscode.window.showTextDocument(doc);
      console.log(`  Opened file → Download triggered`);
      
      await waitForExtension(3000);
      
      const content = await readFile(localFile);
      console.log(`  Local after download: "${content}"`);
      
      assert.equal(content, 'Remote version', 'Local should be overwritten');
    });
  });

  describe('Folder Download', () => {
    it('downloads folder structure from remote', async function() {
      // Create folder structure on remote
      await createRemoteFile(E2E_VM_CONFIG, 'remote-folder/file1.txt', 'Remote 1');
      await createRemoteFile(E2E_VM_CONFIG, 'remote-folder/file2.txt', 'Remote 2');
      console.log(`  Created on remote:`);
      console.log(`    remote-folder/file1.txt`);
      console.log(`    remote-folder/file2.txt`);
      
      // Trigger refresh to download
      await vscode.commands.executeCommand('livesync.experimental.refresh', workspaceFolder);
      console.log(`  Executed refresh command`);
      
      await waitForExtension(5000);
      
      // Check if files downloaded
      const file1Exists = await fileExists(path.join(workspacePath, 'remote-folder/file1.txt'));
      const file2Exists = await fileExists(path.join(workspacePath, 'remote-folder/file2.txt'));
      
      console.log(`  Local structure:`);
      console.log(`    remote-folder/file1.txt: ${file1Exists ? '✓' : '✗'}`);
      console.log(`    remote-folder/file2.txt: ${file2Exists ? '✓' : '✗'}`);
      
      assert.ok(file1Exists && file2Exists, 'Folder structure should be downloaded');
    });
  });

  describe('Bidirectional Sync', () => {
    it('syncs local changes to remote', async function() {
      const testFile = await createTestFile(workspacePath, 'bidirectional.txt', 'Initial');
      await modifyAndSaveFile(testFile, 'Initial');
      await waitForExtension(2000);
      
      // Verify uploaded
      let remoteContent = await getRemoteContent(E2E_VM_CONFIG, 'bidirectional.txt');
      assert.equal(remoteContent, 'Initial', 'Initial upload should work');
      console.log(`  ✓ Initial upload: "Initial"`);
      
      // Modify locally
      await modifyAndSaveFile(testFile, 'Modified locally');
      await waitForExtension(2000);
      
      // Verify synced to remote
      remoteContent = await getRemoteContent(E2E_VM_CONFIG, 'bidirectional.txt');
      assert.equal(remoteContent, 'Modified locally', 'Modification should sync');
      console.log(`  ✓ Modified upload: "Modified locally"`);
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

async function isVMAccessible(): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new SSHClient();
    const timeout = setTimeout(() => {
      client.end();
      resolve(false);
    }, 5000);

    client.on('ready', () => {
      clearTimeout(timeout);
      client.end();
      resolve(true);
    }).on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    }).connect({
      host: E2E_VM_CONFIG.hostname,
      port: E2E_VM_CONFIG.port,
      username: E2E_VM_CONFIG.username,
      password: E2E_VM_CONFIG.password,
      readyTimeout: 5000,
    });
  });
}

async function checkRemoteFile(config: typeof E2E_VM_CONFIG, relativePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new SSHClient();
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; client.end(); resolve(false); }
    }, 5000);

    client.on('ready', () => {
      const remotePath = `${config.remotePath}/${relativePath}`;
      client.exec(`test -f "${remotePath}" && echo "yes" || echo "no"`, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          if (!resolved) { resolved = true; resolve(false); }
          return;
        }
        let output = '';
        stream.on('data', (d: Buffer) => output += d.toString());
        stream.on('exit', () => {
          clearTimeout(timeout);
          client.end();
          if (!resolved) { resolved = true; resolve(output.trim() === 'yes'); }
        });
      });
    }).on('error', () => {
      clearTimeout(timeout);
      if (!resolved) { resolved = true; resolve(false); }
    }).connect({
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
    client.on('ready', () => {
      const remotePath = `${config.remotePath}/${relativePath}`;
      client.exec(`cat "${remotePath}"`, (err, stream) => {
        if (err) { client.end(); return reject(err); }
        let output = '';
        stream.on('data', (d: Buffer) => output += d.toString());
        stream.on('exit', () => { client.end(); resolve(output); });
      });
    }).on('error', reject).connect({
      host: config.hostname,
      port: config.port,
      username: config.username,
      password: config.password,
    });
  });
}

async function createRemoteFile(config: typeof E2E_VM_CONFIG, relativePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    client.on('ready', () => {
      const remotePath = `${config.remotePath}/${relativePath}`;
      const dir = path.dirname(remotePath);
      const cmd = `mkdir -p "${dir}" && echo "${content}" > "${remotePath}"`;
      client.exec(cmd, (err, stream) => {
        if (err) { client.end(); return reject(err); }
        stream.on('exit', () => { client.end(); resolve(); });
      });
    }).on('error', reject).connect({
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
      if (!resolved) { resolved = true; client.end(); reject(new Error('Timeout')); }
    }, 10000);

    client.on('ready', () => {
      client.exec(`rm -rf "${remotePath}" && mkdir -p "${remotePath}"`, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          if (!resolved) { resolved = true; reject(err); }
          return;
        }
        stream.on('exit', () => {
          clearTimeout(timeout);
          client.end();
          if (!resolved) { resolved = true; resolve(); }
        });
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      if (!resolved) { resolved = true; reject(err); }
    }).connect({
      host: E2E_VM_CONFIG.hostname,
      port: E2E_VM_CONFIG.port,
      username: E2E_VM_CONFIG.username,
      password: E2E_VM_CONFIG.password,
    });
  });
}