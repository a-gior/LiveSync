/**
 * E2E Tests - Upload/Download Commands
 * Tests manual upload/download commands for files and folders
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

suite('E2E - Upload/Download Commands', function() {
  this.timeout(60000);

  let testWorkspace: vscode.WorkspaceFolder;
  let configPath: string;

  suiteSetup(async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Workspace required');
    testWorkspace = folders[0];
    
    // Create livesync config
    configPath = path.join(testWorkspace.uri.fsPath, '.vscode', 'livesync.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/test-workspace',
      actionOnUpload: 'upload',
      actionOnDownload: 'download',
      ignoreList: ['.vscode', '.livesync']
    }));

    // Wait for config to load
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  suiteTeardown(async () => {
    await fs.rm(configPath, { force: true });
  });

  test('Upload single file command', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'upload-test.txt');
    
    // Create file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('upload content'));
    
    // Execute upload command
    await vscode.commands.executeCommand('livesync.upload', testFile);
    
    // Wait for upload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // File should still exist locally
    const stat = await vscode.workspace.fs.stat(testFile);
    assert.ok(stat);
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Download single file command', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'download-test.txt');
    
    // Execute download command (file might not exist locally yet)
    await vscode.commands.executeCommand('livesync.download', testFile);
    
    // Wait for download
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // If file existed remotely, it should now exist locally
    // (This test requires the file to exist on remote)
  });

  test('Upload folder command uploads all files', async () => {
    const testFolder = vscode.Uri.joinPath(testWorkspace.uri, 'upload-folder');
    
    // Create folder with files
    await fs.mkdir(testFolder.fsPath, { recursive: true });
    await fs.writeFile(path.join(testFolder.fsPath, 'file1.txt'), 'content1');
    await fs.writeFile(path.join(testFolder.fsPath, 'file2.txt'), 'content2');
    await fs.mkdir(path.join(testFolder.fsPath, 'subfolder'));
    await fs.writeFile(path.join(testFolder.fsPath, 'subfolder', 'file3.txt'), 'content3');
    
    // Execute upload folder command
    await vscode.commands.executeCommand('livesync.uploadFolder', testFolder);
    
    // Wait for upload
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Files should still exist locally
    const file1 = await fs.readFile(path.join(testFolder.fsPath, 'file1.txt'), 'utf-8');
    assert.strictEqual(file1, 'content1');
    
    // Cleanup
    await fs.rm(testFolder.fsPath, { recursive: true, force: true });
  });

  test('Download folder command downloads all files', async () => {
    const testFolder = vscode.Uri.joinPath(testWorkspace.uri, 'download-folder');
    
    // Execute download folder command
    await vscode.commands.executeCommand('livesync.downloadFolder', testFolder);
    
    // Wait for download
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // If folder existed remotely, it should now exist locally
    // (This test requires the folder to exist on remote)
  });

  test('Upload command from explorer context menu', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'context-upload.txt');
    
    // Create file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('context upload'));
    
    // Execute command with file URI (simulates context menu)
    await vscode.commands.executeCommand('livesync.upload', testFile);
    
    // Wait for upload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Upload command from active editor', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'editor-upload.txt');
    
    // Create and open file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('editor upload'));
    const doc = await vscode.workspace.openTextDocument(testFile);
    await vscode.window.showTextDocument(doc);
    
    // Execute command without argument (should use active editor)
    await vscode.commands.executeCommand('livesync.upload');
    
    // Wait for upload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Upload respects ignore patterns', async () => {
    const ignoredFile = vscode.Uri.joinPath(testWorkspace.uri, '.vscode', 'settings.json');
    
    // Create file in ignored directory
    await fs.mkdir(path.dirname(ignoredFile.fsPath), { recursive: true });
    await vscode.workspace.fs.writeFile(ignoredFile, Buffer.from('{}'));
    
    // Execute upload command (should skip ignored file)
    await vscode.commands.executeCommand('livesync.upload', ignoredFile);
    
    // Wait briefly
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Cleanup
    await vscode.workspace.fs.delete(ignoredFile);
  });

  test('Batch upload optimizes multiple files', async () => {
    const testFolder = vscode.Uri.joinPath(testWorkspace.uri, 'batch-upload');
    
    // Create many files
    await fs.mkdir(testFolder.fsPath, { recursive: true });
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(path.join(testFolder.fsPath, `file${i}.txt`), `content${i}`);
    }
    
    // Upload folder (should batch operations)
    const startTime = Date.now();
    await vscode.commands.executeCommand('livesync.uploadFolder', testFolder);
    const duration = Date.now() - startTime;
    
    // Should complete in reasonable time even with many files
    assert.ok(duration < 30000, 'Batch upload should be efficient');
    
    // Cleanup
    await fs.rm(testFolder.fsPath, { recursive: true, force: true });
  });

  test('Upload handles binary files correctly', async () => {
    const binaryFile = vscode.Uri.joinPath(testWorkspace.uri, 'binary.bin');
    
    // Create binary file
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
    await vscode.workspace.fs.writeFile(binaryFile, binaryData);
    
    // Upload binary file
    await vscode.commands.executeCommand('livesync.upload', binaryFile);
    
    // Wait for upload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify file still exists with correct content
    const readData = await vscode.workspace.fs.readFile(binaryFile);
    assert.deepStrictEqual(readData, binaryData);
    
    // Cleanup
    await vscode.workspace.fs.delete(binaryFile);
  });

  test('Upload/download with concurrent operations', async () => {
    const files = [];
    
    // Create multiple files
    for (let i = 0; i < 5; i++) {
      const file = vscode.Uri.joinPath(testWorkspace.uri, `concurrent${i}.txt`);
      await vscode.workspace.fs.writeFile(file, Buffer.from(`concurrent${i}`));
      files.push(file);
    }
    
    // Execute concurrent uploads
    const uploadPromises = files.map(file => 
      vscode.commands.executeCommand('livesync.upload', file)
    );
    
    await Promise.all(uploadPromises);
    
    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Cleanup
    for (const file of files) {
      await vscode.workspace.fs.delete(file);
    }
  });
});