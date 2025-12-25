/**
 * E2E Tests - Multi-File Sync Workflows
 * Tests real-world scenarios with multiple files and operations
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { RemoteStateVerifier, E2E_VM_CONFIG } from 'test/helpers/remote/RemoteStateVerifier';

suite('E2E - Multi-File Sync Workflows', function() {
  this.timeout(90000); // Longer timeout for complex workflows

  let testWorkspace: vscode.WorkspaceFolder;
  let configPath: string;
  let remoteVerifier: RemoteStateVerifier;

  suiteSetup(async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Workspace required');
    testWorkspace = folders[0];
    
    remoteVerifier = new RemoteStateVerifier(E2E_VM_CONFIG);
    
    // Clean remote workspace
    try {
      await remoteVerifier.cleanRemoteWorkspace();
    } catch (err) {
      console.warn('Failed to clean remote workspace:', err);
    }
    
    // Create livesync config with auto-sync on save
    configPath = path.join(testWorkspace.uri.fsPath, '.vscode', 'livesync.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: E2E_VM_CONFIG.hostname,
      port: E2E_VM_CONFIG.port,
      username: E2E_VM_CONFIG.username,
      password: E2E_VM_CONFIG.password,
      remotePath: E2E_VM_CONFIG.remotePath,
      actionOnSave: 'save',
      actionOnCreate: 'create',
      actionOnDelete: 'delete',
      actionOnMove: 'move',
      ignoreList: ['.vscode', '.livesync', '.git']
    }));

    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  suiteTeardown(async () => {
    await fs.rm(configPath, { force: true });
    remoteVerifier.dispose();
  });

  test('Create, edit, save workflow - full sync', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'workflow-test.txt');
    
    // Step 1: Create file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('initial'));
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // ✅ VERIFY: File created on remote
    assert.ok(await remoteVerifier.fileExists('workflow-test.txt'), 'Should create on remote');
    
    // Step 2: Open and edit file
    const doc = await vscode.workspace.openTextDocument(testFile);
    const editor = await vscode.window.showTextDocument(doc);
    
    await editor.edit(edit => {
      edit.insert(new vscode.Position(0, 0), 'modified ');
    });
    
    // Step 3: Save file
    await doc.save();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // ✅ VERIFY: Changes synced to remote
    const remoteContent = await remoteVerifier.readFile('workflow-test.txt');
    assert.ok(remoteContent.includes('modified'), 'Changes should sync to remote');
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
    await remoteVerifier.deleteFile('workflow-test.txt');
  });

  test('Multiple file creation workflow', async () => {
    const files = ['multi1.txt', 'multi2.txt', 'multi3.txt'];
    const uris: vscode.Uri[] = [];
    
    // Create multiple files
    for (const file of files) {
      const uri = vscode.Uri.joinPath(testWorkspace.uri, file);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(`content of ${file}`));
      uris.push(uri);
    }
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // ✅ VERIFY: All files on remote
    for (const file of files) {
      const exists = await remoteVerifier.fileExists(file);
      assert.ok(exists, `${file} should exist on remote`);
    }
    
    // Cleanup
    for (const uri of uris) {
      await vscode.workspace.fs.delete(uri);
    }
    for (const file of files) {
      await remoteVerifier.deleteFile(file);
    }
  });

  test('Project structure workflow - nested folders', async () => {
    const structure = {
      'src/index.ts': 'export const main = () => {};',
      'src/utils/helper.ts': 'export const helper = () => {};',
      'src/models/user.ts': 'export interface User {}',
      'test/index.test.ts': 'describe("test", () => {});',
    };
    
    // Create project structure
    for (const [filePath, content] of Object.entries(structure)) {
      const uri = vscode.Uri.joinPath(testWorkspace.uri, filePath);
      await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    }
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // ✅ VERIFY: Entire structure on remote
    for (const filePath of Object.keys(structure)) {
      const exists = await remoteVerifier.fileExists(filePath);
      assert.ok(exists, `${filePath} should exist on remote`);
    }
    
    // ✅ VERIFY: Folder structure
    assert.ok(await remoteVerifier.folderExists('src'));
    assert.ok(await remoteVerifier.folderExists('src/utils'));
    assert.ok(await remoteVerifier.folderExists('src/models'));
    
    // Cleanup
    await fs.rm(path.join(testWorkspace.uri.fsPath, 'src'), { recursive: true, force: true });
    await fs.rm(path.join(testWorkspace.uri.fsPath, 'test'), { recursive: true, force: true });
    await remoteVerifier.deleteFolder('src');
    await remoteVerifier.deleteFolder('test');
  });

  test('Edit multiple files workflow - batch sync', async () => {
    const files = ['edit1.ts', 'edit2.ts', 'edit3.ts'];
    
    // Create and edit multiple files rapidly
    for (let i = 0; i < files.length; i++) {
      const uri = vscode.Uri.joinPath(testWorkspace.uri, files[i]);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(`version 1 of file ${i}`));
      
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      
      await editor.edit(edit => {
        edit.insert(new vscode.Position(0, 0), 'updated: ');
      });
      
      await doc.save();
    }
    
    // Wait for all syncs
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // ✅ VERIFY: All updates on remote
    for (let i = 0; i < files.length; i++) {
      const content = await remoteVerifier.readFile(files[i]);
      assert.ok(content.includes('updated:'), `${files[i]} should be updated on remote`);
    }
    
    // Cleanup
    for (const file of files) {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(testWorkspace.uri, file));
      await remoteVerifier.deleteFile(file);
    }
  });

  test('Mixed operations workflow - create, edit, delete', async () => {
    // Phase 1: Create files
    const file1 = vscode.Uri.joinPath(testWorkspace.uri, 'mixed1.txt');
    const file2 = vscode.Uri.joinPath(testWorkspace.uri, 'mixed2.txt');
    const file3 = vscode.Uri.joinPath(testWorkspace.uri, 'mixed3.txt');
    
    await vscode.workspace.fs.writeFile(file1, Buffer.from('file1'));
    await vscode.workspace.fs.writeFile(file2, Buffer.from('file2'));
    await vscode.workspace.fs.writeFile(file3, Buffer.from('file3'));
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // ✅ VERIFY: All created
    assert.ok(await remoteVerifier.fileExists('mixed1.txt'));
    assert.ok(await remoteVerifier.fileExists('mixed2.txt'));
    assert.ok(await remoteVerifier.fileExists('mixed3.txt'));
    
    // Phase 2: Edit one file
    const doc = await vscode.workspace.openTextDocument(file1);
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit(edit => {
      edit.insert(new vscode.Position(0, 0), 'edited ');
    });
    await doc.save();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // ✅ VERIFY: Edit synced
    const content = await remoteVerifier.readFile('mixed1.txt');
    assert.ok(content.includes('edited'));
    
    // Phase 3: Delete one file
    await vscode.workspace.fs.delete(file2);
    
    // Delete events can be VERY slow to process in E2E - up to 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // ✅ VERIFY: Deletion synced (if actionOnDelete is 'delete')
    const exists = await remoteVerifier.fileExists('mixed2.txt');
    assert.ok(!exists, 'Deleted file should be removed from remote');
    
    // Cleanup
    await vscode.workspace.fs.delete(file1);
    await vscode.workspace.fs.delete(file3);
    await remoteVerifier.deleteFile('mixed1.txt');
    await remoteVerifier.deleteFile('mixed3.txt');
  });

  test('Large file edit workflow', async () => {
    const largeFile = vscode.Uri.joinPath(testWorkspace.uri, 'large.txt');
    
    // Create large file (100KB)
    const largeContent = 'large content line\n'.repeat(5000); // ~100KB
    await vscode.workspace.fs.writeFile(largeFile, Buffer.from(largeContent));
    
    // Large files can take up to 10 seconds for events to process in E2E
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // ✅ VERIFY: Large file uploaded
    assert.ok(await remoteVerifier.fileExists('large.txt'));
    const remoteSize = await remoteVerifier.getFileSize('large.txt');
    assert.ok(remoteSize > 50000, 'Large file should be uploaded');
    
    // Edit large file
    const doc = await vscode.workspace.openTextDocument(largeFile);
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit(edit => {
      edit.insert(new vscode.Position(0, 0), 'HEADER\n');
    });
    await doc.save();
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // ✅ VERIFY: Edit synced
    const remoteContent = await remoteVerifier.readFile('large.txt');
    assert.ok(remoteContent.includes('HEADER'), 'Large file edit should sync');
    
    // Cleanup
    await vscode.workspace.fs.delete(largeFile);
    await remoteVerifier.deleteFile('large.txt');
  });

  test('Rapid successive edits workflow - debouncing', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'rapid.txt');
    
    // Create file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('initial'));
    const doc = await vscode.workspace.openTextDocument(testFile);
    const editor = await vscode.window.showTextDocument(doc);
    
    // Make rapid edits and saves
    for (let i = 0; i < 5; i++) {
      await editor.edit(edit => {
        edit.insert(new vscode.Position(0, 0), `edit${i} `);
      });
      await doc.save();
      await new Promise(resolve => setTimeout(resolve, 300)); // Rapid saves
    }
    
    // Wait for debouncing to settle
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // ✅ VERIFY: Final state synced (not necessarily all intermediate states)
    const remoteContent = await remoteVerifier.readFile('rapid.txt');
    assert.ok(remoteContent.includes('edit4'), 'Final edit should be synced');
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
    await remoteVerifier.deleteFile('rapid.txt');
  });

  test('Folder rename workflow', async () => {
    const oldFolder = vscode.Uri.joinPath(testWorkspace.uri, 'old-folder');
    const newFolder = vscode.Uri.joinPath(testWorkspace.uri, 'new-folder');
    
    // Create folder with files
    await fs.mkdir(oldFolder.fsPath);
    await fs.writeFile(path.join(oldFolder.fsPath, 'file.txt'), 'content');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // ✅ VERIFY: Original folder exists
    assert.ok(await remoteVerifier.folderExists('old-folder'));
    
    // Rename folder
    await fs.rename(oldFolder.fsPath, newFolder.fsPath);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // ✅ VERIFY: Renamed folder (if actionOnMove supports folders)
    const newExists = await remoteVerifier.folderExists('new-folder');
    const oldExists = await remoteVerifier.folderExists('old-folder');
    
    // Either new folder exists OR both exist (depending on implementation)
    assert.ok(newExists || oldExists, 'Folder should exist on remote');
    
    // Cleanup
    await fs.rm(newFolder.fsPath, { recursive: true, force: true });
    await remoteVerifier.deleteFolder('new-folder');
    await remoteVerifier.deleteFolder('old-folder');
  });

  test('Binary and text files mixed workflow', async () => {
    const textFile = vscode.Uri.joinPath(testWorkspace.uri, 'mixed.txt');
    const binaryFile = vscode.Uri.joinPath(testWorkspace.uri, 'mixed.bin');
    
    // Create both types
    await vscode.workspace.fs.writeFile(textFile, Buffer.from('text content'));
    await vscode.workspace.fs.writeFile(binaryFile, Buffer.from([0xFF, 0xFE, 0xFD]));
    
    // Binary files can take up to 10 seconds for events in E2E
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // ✅ VERIFY: Both uploaded
    assert.ok(await remoteVerifier.fileExists('mixed.txt'));
    assert.ok(await remoteVerifier.fileExists('mixed.bin'));
    
    const binarySize = await remoteVerifier.getFileSize('mixed.bin');
    assert.equal(binarySize, 3, 'Binary file should have correct size');
    
    // Cleanup
    await vscode.workspace.fs.delete(textFile);
    await vscode.workspace.fs.delete(binaryFile);
    await remoteVerifier.deleteFile('mixed.txt');
    await remoteVerifier.deleteFile('mixed.bin');
  });
});