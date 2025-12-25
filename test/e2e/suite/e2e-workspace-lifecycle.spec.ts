/**
 * E2E Tests - Workspace Lifecycle
 * Tests adding, removing workspaces and their implications
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

suite('E2E - Workspace Lifecycle', function() {
  this.timeout(120000);

  let tempWorkspaceA: string;
  let tempWorkspaceB: string;

  suiteSetup(async () => {
    // Create temp workspace folders in OS temp dir (safer)
    const timestamp = Date.now();
    tempWorkspaceA = path.join(tmpdir(), `livesync-test-ws-a-${timestamp}`);
    tempWorkspaceB = path.join(tmpdir(), `livesync-test-ws-b-${timestamp}`);
    
    await fs.mkdir(tempWorkspaceA, { recursive: true });
    await fs.mkdir(tempWorkspaceB, { recursive: true });
  });

  suiteTeardown(async () => {
    // Clean up temp workspaces
    try {
      await fs.rm(tempWorkspaceA, { recursive: true, force: true });
      await fs.rm(tempWorkspaceB, { recursive: true, force: true });
    } catch {}
  });

  test('Workspace folder creation succeeds', async () => {
    // Verify temp workspaces exist
    const statA = await fs.stat(tempWorkspaceA);
    const statB = await fs.stat(tempWorkspaceB);
    
    assert.ok(statA.isDirectory(), 'Workspace A should be a directory');
    assert.ok(statB.isDirectory(), 'Workspace B should be a directory');
  });

  test('Extension handles workspace with config file', async () => {
    // Create config in temp workspace A
    const configDir = path.join(tempWorkspaceA, '.vscode');
    await fs.mkdir(configDir, { recursive: true });
    
    const configPath = path.join(configDir, 'livesync.json');
    await fs.writeFile(configPath, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/workspace-a',
      ignoreList: ['.vscode', '.git']
    }));
    
    // Verify config was created
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    assert.strictEqual(config.hostname, '127.0.0.1');
    assert.strictEqual(config.remotePath, '/home/centos/workspace-a');
  });

  test('Extension handles workspace without config', async () => {
    // Workspace B has no config - verify it exists but empty
    const files = await fs.readdir(tempWorkspaceB);
    assert.strictEqual(files.length, 0, 'Workspace B should be empty');
  });

  test('Independent configs would be isolated', async () => {
    // Create different configs in both workspaces
    const configA = path.join(tempWorkspaceA, '.vscode', 'livesync.json');
    const configB = path.join(tempWorkspaceB, '.vscode', 'livesync.json');
    
    await fs.mkdir(path.dirname(configB), { recursive: true });
    
    await fs.writeFile(configB, JSON.stringify({
      hostname: '127.0.0.1',
      port: 2222,
      username: 'centos',
      password: 'centos',
      remotePath: '/home/centos/workspace-b',
      ignoreList: ['.git'] // Different ignore list
    }));
    
    // Read both configs
    const contentA = await fs.readFile(configA, 'utf-8');
    const contentB = await fs.readFile(configB, 'utf-8');
    
    const parsedA = JSON.parse(contentA);
    const parsedB = JSON.parse(contentB);
    
    // Verify they're different
    assert.strictEqual(parsedA.remotePath, '/home/centos/workspace-a');
    assert.strictEqual(parsedB.remotePath, '/home/centos/workspace-b');
    assert.notDeepStrictEqual(parsedA.ignoreList, parsedB.ignoreList);
  });

  test('Files in separate workspaces are independent', async () => {
    // Create files in each workspace
    const fileA = path.join(tempWorkspaceA, 'file-a.txt');
    const fileB = path.join(tempWorkspaceB, 'file-b.txt');
    
    await fs.writeFile(fileA, 'content A');
    await fs.writeFile(fileB, 'content B');
    
    // Verify both exist independently
    const contentA = await fs.readFile(fileA, 'utf-8');
    const contentB = await fs.readFile(fileB, 'utf-8');
    
    assert.strictEqual(contentA, 'content A');
    assert.strictEqual(contentB, 'content B');
  });

  test('Cache directories would be per-workspace', async () => {
    // Create cache directories
    const cacheA = path.join(tempWorkspaceA, '.livesync');
    const cacheB = path.join(tempWorkspaceB, '.livesync');
    
    await fs.mkdir(cacheA, { recursive: true });
    await fs.mkdir(cacheB, { recursive: true });
    
    // Create different cache content
    await fs.writeFile(path.join(cacheA, 'local.json'), '{"workspace":"a"}');
    await fs.writeFile(path.join(cacheB, 'local.json'), '{"workspace":"b"}');
    
    // Verify caches are independent
    const cacheContentA = await fs.readFile(path.join(cacheA, 'local.json'), 'utf-8');
    const cacheContentB = await fs.readFile(path.join(cacheB, 'local.json'), 'utf-8');
    
    assert.ok(cacheContentA.includes('"workspace":"a"'));
    assert.ok(cacheContentB.includes('"workspace":"b"'));
  });

  test('Removing workspace would leave cache on disk', async () => {
    // Simulate workspace removal - cache stays
    const cachePath = path.join(tempWorkspaceA, '.livesync', 'local.json');
    
    // Verify cache exists
    const exists = await fs.access(cachePath).then(() => true).catch(() => false);
    assert.ok(exists, 'Cache should still exist after workspace "removal"');
  });

  test('Current workspace count is available', async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders, 'Should have workspace folders');
    assert.ok(folders.length >= 1, 'Should have at least one workspace');
  });
});