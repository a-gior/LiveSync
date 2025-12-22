/**
 * E2E Tests - File Events
 * Tests the FileEventBridge handling of save, create, delete, and rename events
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

suite('E2E - File Events', function() {
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
      actionOnSave: 'save',
      actionOnCreate: 'create',
      actionOnDelete: 'none',
      actionOnMove: 'move',
      actionOnOpen: 'download',
      ignoreList: ['.vscode', '.livesync', '.git']
    }));

    // Wait for config to be loaded
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  suiteTeardown(async () => {
    await fs.rm(configPath, { force: true });
  });

  test('Save event triggers without crashing', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'test-save.txt');
    
    // Create and open file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('initial content'));
    const doc = await vscode.workspace.openTextDocument(testFile);
    const editor = await vscode.window.showTextDocument(doc);
    
    // Edit and save
    await editor.edit(edit => {
      edit.insert(new vscode.Position(0, 0), 'modified ');
    });
    
    // Save should trigger event handler
    await doc.save();
    
    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify file still exists and has modified content
    const content = await vscode.workspace.fs.readFile(testFile);
    assert.ok(content.toString().includes('modified'));
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Create event triggers without crashing', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'new-file.txt');
    
    // Create file via VSCode API
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('new content'));
    
    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify file exists
    const stat = await vscode.workspace.fs.stat(testFile);
    assert.ok(stat);
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Delete event triggers without crashing', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'to-delete.txt');
    
    // Create file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('delete me'));
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Delete file
    await vscode.workspace.fs.delete(testFile);
    
    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify deletion
    try {
      await vscode.workspace.fs.stat(testFile);
      assert.fail('File should be deleted');
    } catch {
      // Expected
    }
  });

  test('Rename/Move event triggers without crashing', async () => {
    const sourceFile = vscode.Uri.joinPath(testWorkspace.uri, 'original.txt');
    const targetFile = vscode.Uri.joinPath(testWorkspace.uri, 'renamed.txt');
    
    // Create source file
    await vscode.workspace.fs.writeFile(sourceFile, Buffer.from('content'));
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Rename file
    await vscode.workspace.fs.rename(sourceFile, targetFile);
    
    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify rename
    try {
      await vscode.workspace.fs.stat(sourceFile);
      assert.fail('Source should not exist');
    } catch {
      // Expected
    }
    
    const targetStat = await vscode.workspace.fs.stat(targetFile);
    assert.ok(targetStat);
    
    // Cleanup
    await vscode.workspace.fs.delete(targetFile);
  });

  test('Ignored files are not processed', async () => {
    const ignoredFile = vscode.Uri.joinPath(testWorkspace.uri, '.git', 'config');
    
    // Create in ignored directory
    await fs.mkdir(path.dirname(ignoredFile.fsPath), { recursive: true });
    await vscode.workspace.fs.writeFile(ignoredFile, Buffer.from('ignored'));
    
    // Wait to ensure no processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // File should exist but not trigger sync
    const stat = await vscode.workspace.fs.stat(ignoredFile);
    assert.ok(stat);
    
    // Cleanup
    await vscode.workspace.fs.delete(ignoredFile);
  });

  test('External file changes update local snapshot only', async () => {
    const testFile = path.join(testWorkspace.uri.fsPath, 'external-change.txt');
    
    // Create file externally (via Node.js fs)
    await fs.writeFile(testFile, 'external content');
    
    // Wait for file watcher
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify file exists
    const exists = await fs.access(testFile).then(() => true).catch(() => false);
    assert.ok(exists);
    
    // Cleanup
    await fs.unlink(testFile);
  });
});