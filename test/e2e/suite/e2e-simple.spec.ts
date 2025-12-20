/**
 * Minimal E2E Test - Verify vscode-test setup works
 * Place in: test/e2e/suite/e2e-minimal.spec.ts
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('E2E - Minimal Test', () => {
  
  test('VSCode workspace is open', async function() {
    this.timeout(10000);
    
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders, 'Should have workspace folders');
    assert.ok(folders!.length > 0, 'Should have at least one workspace');
    
    console.log('✓ Workspace:', folders![0].uri.fsPath);
  });

  test('Extension is loaded', async function() {
    this.timeout(10000);
    
    const ext = vscode.extensions.getExtension('agior.livesync');
    assert.ok(ext, 'Should have livesync extension loaded');
    // If you don't know the ID, just check any extension exists
    const allExt = vscode.extensions.all;
    assert.ok(allExt.length > 0, 'Should have extensions loaded');
    
    console.log('✓ Extensions loaded:', allExt.length);
  });

  test('Can create a file', async function() {
    this.timeout(10000);
    
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.skip();
      return;
    }
    
    const testFile = vscode.Uri.joinPath(folders[0].uri, 'test-minimal.txt');
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('Hello E2E'));
    
    const content = await vscode.workspace.fs.readFile(testFile);
    assert.strictEqual(content.toString(), 'Hello E2E');
    
    console.log('✓ File created successfully');
  });
});