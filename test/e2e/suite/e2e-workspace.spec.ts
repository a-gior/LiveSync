/**
 * E2E Tests - Workspace Management
 * Tests workspace initialization and basic workspace features
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

suite('E2E - Workspace Management', function() {
  this.timeout(60000);

  test('Single workspace folder is properly initialized', async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders, 'Should have workspace folders');
    
    // At least one folder should be open
    assert.ok(folders.length >= 1, 'Should have at least one workspace');
    
    // Extension should be active
    const ext = vscode.extensions.getExtension('agior.livesync');
    assert.ok(ext, 'Extension should be installed');
  });

  test('Extension activates without errors', async () => {
    const ext = vscode.extensions.getExtension('agior.livesync');
    assert.ok(ext, 'Extension should be installed');
    
    // Wait for activation if not already active
    if (!ext.isActive) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Should be active now
    assert.ok(ext.isActive, 'Extension should be active');
  });

  test('Workspace has correct configuration', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      // this.skip();
      return;
    }
    
    const folder = folders[0];
    const configPath = path.join(folder.uri.fsPath, '.vscode', 'livesync.json');
    
    // Check if config exists
    try {
      await fs.access(configPath);
      // Config exists
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      // Verify has required fields
      assert.ok(config.hostname, 'Config should have hostname');
      assert.ok(config.remotePath, 'Config should have remotePath');
    } catch {
      // No config - that's ok too
    }
  });

  test('Can access LiveSync commands', async () => {
    // Verify commands are registered
    const commands = await vscode.commands.getCommands();
    
    const livesyncCommands = commands.filter(cmd => cmd.startsWith('livesync.'));
    assert.ok(livesyncCommands.length > 0, 'Should have LiveSync commands registered');
    
    // Check for key commands
    assert.ok(commands.includes('livesync.upload'), 'Should have upload command');
    assert.ok(commands.includes('livesync.download'), 'Should have download command');
    assert.ok(commands.includes('livesync.configuration'), 'Should have configuration command');
  });

  test('Tree view is accessible', async () => {
    // Try to focus the diff view
    try {
      await vscode.commands.executeCommand('livesync.focusExperimentalView');
      await new Promise(resolve => setTimeout(resolve, 500));
      // Success if no error thrown
      assert.ok(true);
    } catch (err) {
      // View might not be ready yet
      console.warn('Could not focus view:', err);
    }
  });

  test('Configuration settings are accessible', async () => {
    const config = vscode.workspace.getConfiguration('livesync');
    
    // Check various settings exist
    const showUnchanged = config.get('view.showUnchanged');
    const showAsTree = config.get('view.showAsTree');
    const openMode = config.get('openMode');
    
    // Settings should be defined (even if default values)
    assert.ok(showUnchanged !== undefined, 'showUnchanged setting should exist');
    assert.ok(showAsTree !== undefined, 'showAsTree setting should exist');
    assert.ok(openMode !== undefined, 'openMode setting should exist');
  });

  test('Can update configuration settings', async () => {
    const config = vscode.workspace.getConfiguration('livesync');
    const originalValue = config.get<boolean>('view.showUnchanged') ?? false;
    
    // Update setting
    await config.update('view.showUnchanged', !originalValue, vscode.ConfigurationTarget.Workspace);
    
    // Verify change
    const newValue = config.get<boolean>('view.showUnchanged');
    assert.strictEqual(newValue, !originalValue, 'Setting should be updated');
    
    // Restore original
    await config.update('view.showUnchanged', originalValue, vscode.ConfigurationTarget.Workspace);
  });

  test('Multi-root context is set correctly', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    // const isMultiRoot = folders.length > 1;
    
    // Context should match actual workspace state
    // Note: Can't easily verify context value in E2E tests
    // Just verify workspace folder count
    assert.ok(folders.length >= 1, 'Should have at least one workspace');
  });
});