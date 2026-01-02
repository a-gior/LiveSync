import 'tsconfig-paths/register';

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

let configPath: string;
let originalConfig: string | null = null;

export async function mochaGlobalSetup() {
  console.log('\n=== E2E Global Setup ===');
  
  // Wait for workspace to be available
  let folders = vscode.workspace.workspaceFolders;
  let attempts = 0;
  while (!folders && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 500));
    folders = vscode.workspace.workspaceFolders;
    attempts++;
  }
  
  if (!folders) throw new Error('No workspace after waiting');
  
  const workspace = folders[0];
  configPath = path.join(workspace.uri.fsPath, '.vscode', 'livesync.json');
  
  // Backup existing
  try {
    originalConfig = await fs.readFile(configPath, 'utf-8');
  } catch {}
  
  // Create test config
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({
    hostname: '127.0.0.1',
    port: 2222,
    username: 'centos',
    password: 'centos',
    remotePath: '/home/centos/e2e-test-workspace',
    actionOnUpload: 'upload',
    actionOnDownload: 'download',
    actionOnSave: 'save',
    actionOnCreate: 'create',
    actionOnDelete: 'none',
    actionOnMove: 'move',
    actionOnOpen: 'download',
    ignoreList: ['.vscode', '.livesync', '.git']
  }, null, 2));
  
  console.log('✓ Created test config');
  
  // Activate extension
  const ext = vscode.extensions.getExtension('agior.livesync');
  if (ext && !ext.isActive) {
    await ext.activate();
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('=== Setup Complete ===\n');
}

export async function mochaGlobalTeardown() {
  console.log('\n=== E2E Global Teardown ===');
  
  if (!configPath) return;
  
  // Restore or delete
  try {
    if (originalConfig) {
      await fs.writeFile(configPath, originalConfig);
    } else {
      await fs.unlink(configPath);
    }
  } catch (err) {
    // Ignore if file doesn't exist (already cleaned up)
  }
  
  console.log('=== Teardown Complete ===\n');
}