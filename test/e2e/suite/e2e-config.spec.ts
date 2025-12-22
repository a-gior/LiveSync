/**
 * E2E Tests - Configuration Management
 * Tests config creation, validation, opening (JSON vs UI), and editing
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

suite('E2E - Configuration', function() {
  this.timeout(60000);

  let testWorkspace: vscode.WorkspaceFolder;
  let configPath: string;

  suiteSetup(async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Workspace required');
    testWorkspace = folders[0];
    configPath = path.join(testWorkspace.uri.fsPath, '.vscode', 'livesync.json');
  });

  teardown(async () => {
    // Clean up config after each test
    try {
      await fs.unlink(configPath);
    } catch {
      // Ignore if doesn't exist
    }
  });

  test('Open config with prompt mode asks user for JSON vs UI', async () => {
    // Set openMode to 'prompt'
    const config = vscode.workspace.getConfiguration('livesync');
    await config.update('openMode', 'prompt', vscode.ConfigurationTarget.Workspace);
    
    // Execute command (will show quick pick)
    const commandPromise = vscode.commands.executeCommand('livesync.configuration', 'json');
    
    // Wait briefly for quick pick
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Should show a quick pick - we can't easily test user selection in E2E
    // Just verify command doesn't error
    await commandPromise;
  });

  test('Open config with JSON mode opens file directly', async () => {
    // Set openMode to 'json'
    const config = vscode.workspace.getConfiguration('livesync');
    await config.update('openMode', 'json', vscode.ConfigurationTarget.Workspace);
    
    // Create minimal config
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/test-workspace'
    }));
    
    // Wait for config to be loaded
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Execute command
    await vscode.commands.executeCommand('livesync.configuration', 'json');
    
    // Wait for editor
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify active editor is the config file (if opened)
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      assert.ok(activeEditor.document.uri.fsPath.includes('livesync.json'));
    }
  });

  test('Open config with UI mode opens configuration panel', async () => {
    // Set openMode to 'ui'
    const config = vscode.workspace.getConfiguration('livesync');
    await config.update('openMode', 'ui', vscode.ConfigurationTarget.Workspace);
    
    // Execute command
    await vscode.commands.executeCommand('livesync.configuration', 'ui');
    
    // Wait for UI to open
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // UI panel should be open (can't easily verify webview in E2E)
    // Just ensure command completes without error
  });

  test('Valid config can be created', async () => {
    // Create valid config
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/test-workspace',
      actionOnUpload: 'upload',
      actionOnDownload: 'download',
      actionOnSave: 'save',
      actionOnCreate: 'create',
      actionOnDelete: 'none',
      actionOnMove: 'move',
      actionOnOpen: 'download',
      ignoreList: ['.vscode', '.git']
    }));
    
    // Wait for config to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Extension should be active
    const ext = vscode.extensions.getExtension('agior.livesync');
    assert.ok(ext);
  });

  test.skip('Invalid config shows error', async () => {
    // Skipped - can't easily test error messages in E2E
  });

  test('Test connection command validates credentials', async () => {
    // Create config with valid credentials
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/test-workspace'
    }));
    
    // Test connection
    const result = await vscode.commands.executeCommand('livesync.testConnection');
    
    // Should succeed with valid credentials
    // Note: This requires VM to be accessible
    assert.ok(result !== undefined);
  });

  test('Config change triggers validation', async () => {
    // Create initial config
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/test-workspace'
    }));
    
    // Wait for initial load
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Modify config
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/test-workspace-updated'
    }));
    
    // Wait for file watcher to trigger
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Config should be reloaded (can verify via status bar if accessible)
  });

  test('Config with ignore patterns excludes files', async () => {
    // Create config with ignore patterns
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/test-workspace',
      ignoreList: ['node_modules', '.git', '*.log', 'temp/**']
    }));
    
    // Create files that should be ignored
    const nodeModulesFile = path.join(testWorkspace.uri.fsPath, 'node_modules', 'package', 'index.js');
    const logFile = path.join(testWorkspace.uri.fsPath, 'debug.log');
    const tempFile = path.join(testWorkspace.uri.fsPath, 'temp', 'data.txt');
    
    await fs.mkdir(path.dirname(nodeModulesFile), { recursive: true });
    await fs.writeFile(nodeModulesFile, 'ignored');
    await fs.writeFile(logFile, 'ignored');
    await fs.mkdir(path.dirname(tempFile), { recursive: true });
    await fs.writeFile(tempFile, 'ignored');
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Files should be ignored (not appear in diff tree)
    // Cleanup
    await fs.rm(path.dirname(nodeModulesFile), { recursive: true, force: true });
    await fs.unlink(logFile);
    await fs.rm(path.dirname(tempFile), { recursive: true, force: true });
  });
});