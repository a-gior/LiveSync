import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Client as SSHClient } from 'ssh2';

const VM_CONFIG = {
  hostname: '192.168.1.17',
  port: 22,
  username: 'centos',
  password: 'centos',
  remotePath: '/home/centos/vscode-tests',
};

async function execSSH(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    let output = '';

    client.on('ready', () => {
      client.exec(cmd, (err, stream) => {
        if (err) {
          client.end();
          return reject(err);
        }

        stream
          .on('data', (chunk: Buffer) => { output += chunk.toString(); })
          .stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); })
          .on('close', () => {
            client.end();
            resolve(output);
          });
      });
    });

    client.on('error', reject);

    client.connect({
      host: VM_CONFIG.hostname,
      port: VM_CONFIG.port,
      username: VM_CONFIG.username,
      password: VM_CONFIG.password,
    });
  });
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

async function cleanRemote(): Promise<void> {
  try {
    await execSSH(`rm -rf "${VM_CONFIG.remotePath}"`);
    await execSSH(`mkdir -p "${VM_CONFIG.remotePath}"`);
  } catch (err) {
    console.warn('Could not clean remote:', err);
  }
}

async function cleanWorkspace(workspacePath: string): Promise<void> {
  try {
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip .vscode folder
      if (entry.name === '.vscode') {
        continue;
      }
      
      const fullPath = path.join(workspacePath, entry.name);
      
      if (entry.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }
    }
    
    console.log('[TEST SETUP] Workspace cleaned');
  } catch (err) {
    console.warn('[TEST SETUP] Failed to clean workspace:', err);
  }
}

async function remoteFileExists(relPath: string): Promise<boolean> {
  const fullPath = `${VM_CONFIG.remotePath}/${relPath}`;
  try {
    const output = await execSSH(`test -f "${fullPath}" && echo "exists" || echo "not found"`);
    return output.trim() === 'exists';
  } catch {
    return false;
  }
}

async function getRemoteContent(relPath: string): Promise<string> {
  const fullPath = `${VM_CONFIG.remotePath}/${relPath}`;
  return await execSSH(`cat "${fullPath}"`);
}

suite('FileEventBridge - Extension Integration Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let testWorkspacePath: string;

  suiteSetup(async function() {
    this.timeout(30000);
    
    await cleanRemote();
    
    // Workspace is already open by vscode-test
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folders found');
    }
    
    testWorkspaceFolder = folders[0];
    testWorkspacePath = testWorkspaceFolder.uri.fsPath;
    
    console.log('[TEST SETUP] Using workspace:', testWorkspacePath);
    
    // Clean the workspace (except .vscode folder)
    console.log('[TEST SETUP] Cleaning workspace...');
    await cleanWorkspace(testWorkspacePath);
    
    // Trigger refresh to build indexes
    console.log('[TEST SETUP] Triggering refresh...');
    await vscode.commands.executeCommand('livesync.experimental.refresh', testWorkspaceFolder);
    
    // Wait for indexes to build
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('[TEST SETUP] Setup complete');
  });

  suiteTeardown(async function() {
    this.timeout(10000);
    await cleanRemote();
    await cleanWorkspace(testWorkspacePath);
  });

  suite('File Save Events', () => {
    test('Save file triggers upload (actionOnSave: upload)', async function() {
      this.timeout(15000);
      
      const fileName = 'test-save.txt';
      const uri = vscode.Uri.file(path.join(testWorkspacePath, fileName));
      const content = 'Hello from save test';
      
      // Create file first
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
      
      // Open and edit it
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      
      await editor.edit(edit => {
        edit.insert(new vscode.Position(0, 0), 'Modified: ');
      });
      
      console.log('[TEST] Saving file:', fileName);
      await doc.save();
      
      console.log('[TEST] Waiting for remote file...');
      await waitFor(async () => await remoteFileExists(fileName), 10000);
      
      const remoteContent = await getRemoteContent(fileName);
      assert.ok(remoteContent.includes('Modified:'));
      assert.ok(remoteContent.includes(content));
    });
  });

  suite('File Creation Events', () => {
    test('Create file triggers upload (actionOnCreate: upload)', async function() {
      this.timeout(15000);
      
      const fileName = 'test-create.txt';
      const uri = vscode.Uri.file(path.join(testWorkspacePath, fileName));
      const content = 'Created in VSCode';
      
      console.log('[TEST] Creating file using WorkspaceEdit:', fileName);
      
      // Use WorkspaceEdit to trigger onCreate event
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri, { overwrite: false });
      await vscode.workspace.applyEdit(edit);
      
      // Write content
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
      
      // Wait a bit for event processing
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('[TEST] Waiting for remote file...');
      await waitFor(async () => await remoteFileExists(fileName), 10000);
      
      const remoteContent = await getRemoteContent(fileName);
      assert.strictEqual(remoteContent.trim(), content);
    });

    test('Create nested folder structure', async function() {
      this.timeout(15000);
      
      const relPath = 'nested/deep/structure/file.txt';
      const uri = vscode.Uri.file(path.join(testWorkspacePath, relPath));
      const content = 'Nested file';
      
      console.log('[TEST] Creating nested file using WorkspaceEdit:', relPath);
      
      // Use WorkspaceEdit to trigger onCreate event
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri, { overwrite: false });
      await vscode.workspace.applyEdit(edit);
      
      // Write content
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
      
      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('[TEST] Waiting for remote file...');
      await waitFor(async () => await remoteFileExists(relPath), 10000);
      
      const remoteContent = await getRemoteContent(relPath);
      assert.strictEqual(remoteContent.trim(), content);
    });
  });

  suite('File Deletion Events', () => {
    test('Delete file triggers remote deletion (actionOnDelete: delete)', async function() {
      this.timeout(15000);
      
      const fileName = 'test-delete.txt';
      const uri = vscode.Uri.file(path.join(testWorkspacePath, fileName));
      
      // Create file first using WorkspaceEdit
      const createEdit = new vscode.WorkspaceEdit();
      createEdit.createFile(uri, { overwrite: false });
      await vscode.workspace.applyEdit(createEdit);
      
      await vscode.workspace.fs.writeFile(uri, Buffer.from('Will be deleted'));
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Wait for it to be uploaded
      await waitFor(async () => await remoteFileExists(fileName), 10000);
      
      console.log('[TEST] Deleting file using WorkspaceEdit:', fileName);
      
      // Use WorkspaceEdit to trigger onDelete event
      const deleteEdit = new vscode.WorkspaceEdit();
      deleteEdit.deleteFile(uri);
      await vscode.workspace.applyEdit(deleteEdit);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('[TEST] Waiting for remote deletion...');
      await waitFor(async () => !(await remoteFileExists(fileName)), 10000);
      
      const exists = await remoteFileExists(fileName);
      assert.strictEqual(exists, false);
    });
  });

  suite('File Rename/Move Events', () => {
    test('Rename file triggers remote rename (actionOnMove: move)', async function() {
      this.timeout(15000);
      
      const oldName = 'test-rename-old.txt';
      const newName = 'test-rename-new.txt';
      const content = 'Rename test';
      
      const oldUri = vscode.Uri.file(path.join(testWorkspacePath, oldName));
      const newUri = vscode.Uri.file(path.join(testWorkspacePath, newName));
      
      // Create file using WorkspaceEdit
      const createEdit = new vscode.WorkspaceEdit();
      createEdit.createFile(oldUri, { overwrite: false });
      await vscode.workspace.applyEdit(createEdit);
      
      await vscode.workspace.fs.writeFile(oldUri, Buffer.from(content));
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Wait for upload
      await waitFor(async () => await remoteFileExists(oldName), 10000);
      
      console.log('[TEST] Renaming file using WorkspaceEdit:', oldName, '->', newName);
      
      // Use WorkspaceEdit to trigger onRename event
      const renameEdit = new vscode.WorkspaceEdit();
      renameEdit.renameFile(oldUri, newUri);
      await vscode.workspace.applyEdit(renameEdit);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('[TEST] Waiting for remote rename...');
      await waitFor(async () => await remoteFileExists(newName), 10000);
      
      const oldExists = await remoteFileExists(oldName);
      const newExists = await remoteFileExists(newName);
      
      assert.strictEqual(oldExists, false);
      assert.strictEqual(newExists, true);
      
      const remoteContent = await getRemoteContent(newName);
      assert.strictEqual(remoteContent.trim(), content);
    });
  });

  suite('Ignored Files', () => {
    test('Files in .vscode folder are not uploaded', async function() {
      this.timeout(10000);
      
      const fileName = '.vscode/my-settings.json';
      const uri = vscode.Uri.file(path.join(testWorkspacePath, fileName));
      
      await vscode.workspace.fs.writeFile(uri, Buffer.from('{"setting": "value"}'));
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const exists = await remoteFileExists(fileName);
      assert.strictEqual(exists, false);
    });
  });

  suite('Error Handling', () => {
    test('Handle upload error gracefully', async function() {
      this.timeout(10000);
      
      const fileName = 'test-error-handling.txt';
      const uri = vscode.Uri.file(path.join(testWorkspacePath, fileName));
      
      await vscode.workspace.fs.writeFile(uri, Buffer.from('Test content'));
      
      const doc = await vscode.workspace.openTextDocument(uri);
      
      await assert.doesNotReject(async () => {
        await doc.save();
      });
    });
  });
});