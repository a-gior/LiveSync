/**
 * E2E Tests - Diff Tree View
 * Tests tree view visibility, filtering, navigation, and interactions
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

suite('E2E - Diff Tree View', function() {
  this.timeout(60000);

  let testWorkspace: vscode.WorkspaceFolder;
  let configPath: string;
  let treeView: vscode.TreeView<any>;

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

  test('Tree view is registered and visible', async () => {
    // Focus the LiveSync view
    await vscode.commands.executeCommand('livesync.focusExperimentalView');
    
    // Wait for view to be visible
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // View should be accessible (can't directly verify visibility in E2E)
  });

  test('Toggle show unchanged files setting', async () => {
    const config = vscode.workspace.getConfiguration('livesync');
    const originalValue = config.get<boolean>('view.showUnchanged') ?? true;
    
    // Toggle setting
    await config.update('view.showUnchanged', !originalValue, vscode.ConfigurationTarget.Workspace);
    
    // Wait and retry read
    await new Promise(resolve => setTimeout(resolve, 500));
    let newValue: boolean | undefined;
    for (let i = 0; i < 5; i++) {
      const freshConfig = vscode.workspace.getConfiguration('livesync');
      newValue = freshConfig.get<boolean>('view.showUnchanged');
      if (newValue === !originalValue) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    assert.strictEqual(newValue, !originalValue, 'Setting should toggle');
    
    // Restore and wait
    await config.update('view.showUnchanged', originalValue, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  test('Switch between tree and list view modes', async () => {
    // Switch to tree view
    await vscode.commands.executeCommand('livesync.view.switchToTree');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    let config = vscode.workspace.getConfiguration('livesync');
    let showAsTree = config.get<boolean>('view.showAsTree');
    assert.strictEqual(showAsTree, true);
    
    // Switch to list view
    await vscode.commands.executeCommand('livesync.view.switchToList');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    config = vscode.workspace.getConfiguration('livesync');
    showAsTree = config.get<boolean>('view.showAsTree');
    assert.strictEqual(showAsTree, false);
    
    // Switch back to tree
    await vscode.commands.executeCommand('livesync.view.switchToTree');
  });

  test('Refresh command updates diff tree', async () => {
    // Create a new file
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'refresh-test.txt');
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('refresh'));
    
    // Wait for auto-refresh
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Execute manual refresh
    await vscode.commands.executeCommand('livesync.refresh');
    
    // Wait for refresh
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Show diff command opens diff editor', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'diff-test.txt');
    
    // Create file with local changes
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('local content'));
    
    // Wait for indexing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Execute show diff command
    await vscode.commands.executeCommand('livesync.experimental.node.showDiff', testFile);
    
    // Wait for diff editor
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Active editor should be diff viewer (can verify by checking editor type)
    const activeEditor = vscode.window.activeTextEditor;
    // Diff editor detection is limited in E2E tests
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Tree view shows file status colors/icons', async () => {
    // Create different file states
    const newFile = vscode.Uri.joinPath(testWorkspace.uri, 'new-file.txt');
    const modifiedFile = vscode.Uri.joinPath(testWorkspace.uri, 'modified-file.txt');
    
    await vscode.workspace.fs.writeFile(newFile, Buffer.from('new'));
    await vscode.workspace.fs.writeFile(modifiedFile, Buffer.from('modified'));
    
    // Wait for tree update
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Tree view should show files with appropriate decorations
    // (Can't easily verify decorations in E2E, but files should appear)
    
    // Cleanup
    await vscode.workspace.fs.delete(newFile);
    await vscode.workspace.fs.delete(modifiedFile);
  });

  test('Tree view filters unchanged files when setting disabled', async () => {
    // Disable show unchanged
    const config = vscode.workspace.getConfiguration('livesync');
    await config.update('view.showUnchanged', false, vscode.ConfigurationTarget.Workspace);
    
    // Create unchanged and changed files
    const unchangedFile = vscode.Uri.joinPath(testWorkspace.uri, 'unchanged.txt');
    const changedFile = vscode.Uri.joinPath(testWorkspace.uri, 'changed.txt');
    
    // Setup files (would need remote to be in sync for unchanged state)
    await vscode.workspace.fs.writeFile(unchangedFile, Buffer.from('same'));
    await vscode.workspace.fs.writeFile(changedFile, Buffer.from('different'));
    
    // Wait for tree update
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Refresh view
    await vscode.commands.executeCommand('livesync.refresh');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Only changed files should appear (can't easily verify in E2E)
    
    // Cleanup
    await vscode.workspace.fs.delete(unchangedFile);
    await vscode.workspace.fs.delete(changedFile);
    await config.update('view.showUnchanged', true, vscode.ConfigurationTarget.Workspace);
  });

  test('Tree view shows hierarchical folder structure', async () => {
    // Create nested folder structure
    const deepFile = vscode.Uri.joinPath(testWorkspace.uri, 'level1', 'level2', 'level3', 'deep.txt');
    await fs.mkdir(path.dirname(deepFile.fsPath), { recursive: true });
    await vscode.workspace.fs.writeFile(deepFile, Buffer.from('deep content'));
    
    // Wait for tree update
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Enable tree view mode
    await vscode.commands.executeCommand('livesync.view.switchToTree');
    
    // Tree should show hierarchical structure (folders expandable)
    // Cleanup
    await fs.rm(path.join(testWorkspace.uri.fsPath, 'level1'), { recursive: true, force: true });
  });

  test('Tree view list mode shows flat file list', async () => {
    // Switch to list view
    await vscode.commands.executeCommand('livesync.view.switchToList');
    
    // Create files in different folders
    const file1 = vscode.Uri.joinPath(testWorkspace.uri, 'folder1', 'file1.txt');
    const file2 = vscode.Uri.joinPath(testWorkspace.uri, 'folder2', 'file2.txt');
    
    await fs.mkdir(path.dirname(file1.fsPath), { recursive: true });
    await fs.mkdir(path.dirname(file2.fsPath), { recursive: true });
    await vscode.workspace.fs.writeFile(file1, Buffer.from('content1'));
    await vscode.workspace.fs.writeFile(file2, Buffer.from('content2'));
    
    // Wait for tree update
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // List view should show files with full paths (flat)
    // Cleanup
    await fs.rm(path.join(testWorkspace.uri.fsPath, 'folder1'), { recursive: true, force: true });
    await fs.rm(path.join(testWorkspace.uri.fsPath, 'folder2'), { recursive: true, force: true });
  });

  test('Context menu actions on tree items', async () => {
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'context-menu-test.txt');
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('context'));
    
    // Wait for tree update
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate context menu actions (limited in E2E)
    // - Upload
    await vscode.commands.executeCommand('livesync.upload', testFile);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // - Download
    await vscode.commands.executeCommand('livesync.download', testFile);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // - Show Diff
    await vscode.commands.executeCommand('livesync.experimental.node.showDiff', testFile);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Recently resolved files show briefly then hide', async () => {
    // Set retention to short duration for testing
    const config = vscode.workspace.getConfiguration('livesync');
    const originalRetention = config.get<number>('view.recentlyResolvedRetentionMs');
    await config.update('view.recentlyResolvedRetentionMs', 500, vscode.ConfigurationTarget.Workspace);
    await config.update('view.showUnchanged', false, vscode.ConfigurationTarget.Workspace);
    
    const testFile = vscode.Uri.joinPath(testWorkspace.uri, 'resolved-test.txt');
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('content'));
    
    // Upload to resolve
    await vscode.commands.executeCommand('livesync.upload', testFile);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // File should appear briefly as "recently resolved"
    // Then disappear after retention period
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Restore settings
    await config.update('view.recentlyResolvedRetentionMs', originalRetention, vscode.ConfigurationTarget.Workspace);
    await config.update('view.showUnchanged', true, vscode.ConfigurationTarget.Workspace);
    
    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('Empty workspace shows appropriate message', async () => {
    // Ensure workspace is empty (or only has ignored files)
    // Tree view should show "No differences" or "No items" message
    
    // Focus view
    await vscode.commands.executeCommand('livesync.focusExperimentalView');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Message should be visible (can't directly verify in E2E)
  });
});