/**
 * E2E Test Helpers
 * Utilities for setting up test workspaces and files
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';


/**
 * Test SSH connection - standalone version (no dependencies)
 * Uses same logic as your ConfigValidator.testConnection
 */
export async function testConnection(config: {
  hostname: string;
  port: number;
  username: string;
  password: string;
  privateKeyPath?: string;
  passphrase?: string;
}): Promise<{ success: boolean; message: string }> {
  
  const { Client: SSHClient } = await import('ssh2');

  return new Promise((resolve) => {
    const client = new SSHClient();
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          client.end();
          client.destroy();
        } catch {}
        resolve({
          success: false,
          message: 'Connection timeout (3s)',
        });
      }
    }, 3000);

    client
      .on('ready', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.end();
          resolve({
            success: true,
            message: 'Connection successful',
          });
        }
      })
      .on('error', (err: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({
            success: false,
            message: err.message,
          });
        }
      })
      .on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({
            success: false,
            message: 'Connection closed unexpectedly',
          });
        }
      });

    try {
      const connectConfig: any = {
        host: config.hostname,
        port: config.port,
        username: config.username,
        readyTimeout: 3000,
        tryKeyboard: true,
        hostVerifier: () => true,
      };

      if (config.privateKeyPath && config.privateKeyPath.trim() !== '') {
        // Use SSH key if provided
        const fs = require('fs');
        connectConfig.privateKey = fs.readFileSync(config.privateKeyPath);
        if (config.passphrase) {
          connectConfig.passphrase = config.passphrase;
        }
      } else {
        // Use password auth
        connectConfig.password = config.password;
      }

      client.connect(connectConfig);
    } catch (err: any) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          message: err.message,
        });
      }
    }
  });
}


/**
 * Create a temporary test workspace
 */
export async function createTestWorkspace(name: string): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), 'livesync-e2e', name);
  
  // Clean up if exists
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {}
  
  // Create fresh directory
  await fs.mkdir(tmpDir, { recursive: true });
  
  return tmpDir;
}


/**
 * Create LiveSync config in workspace
 */
export async function createLiveSyncConfig(
  workspacePath: string,
  config: Record<string, any>
): Promise<void> {
  const vscodeDir = path.join(workspacePath, '.vscode');
  await fs.mkdir(vscodeDir, { recursive: true });
  
  const configPath = path.join(vscodeDir, 'livesync.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Create a test file in workspace
 */
export async function createTestFile(
  workspacePath: string,
  relativePath: string,
  content: string
): Promise<string> {
  const fullPath = path.join(workspacePath, relativePath);
  const dir = path.dirname(fullPath);
  
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content);
  
  return fullPath;
}

/**
 * Open a file in VSCode editor
 */
export async function openFile(filePath: string): Promise<vscode.TextEditor> {
  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  return await vscode.window.showTextDocument(document);
}

/**
 * Modify and save a file
 */
export async function modifyAndSaveFile(
  filePath: string,
  newContent: string
): Promise<void> {
  const editor = await openFile(filePath);
  
  await editor.edit((editBuilder) => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, newContent);
  });
  
  await editor.document.save();
}

/**
 * Execute a VSCode command
 */
export async function executeCommand<T = unknown>(
  command: string,
  ...args: any[]
): Promise<T> {
  return await vscode.commands.executeCommand<T>(command, ...args);
}

/**
 * Wait for extension to process
 */
export async function waitForExtension(ms: number = 1000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for file to exist
 */
export async function waitForFile(
  filePath: string,
  timeout: number = 5000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  
  return false;
}

/**
 * Get workspace folder by path
 */
export function getWorkspaceFolder(workspacePath: string): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.find(
    (folder) => folder.uri.fsPath === workspacePath
  );
}

/**
 * Clean up test workspace
 */
export async function cleanupTestWorkspace(workspacePath: string): Promise<void> {
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (err) {
    console.warn('Failed to cleanup workspace:', err);
  }
}

/**
 * Read file content
 */
export async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete file
 */
export async function deleteFile(filePath: string): Promise<void> {
  await fs.unlink(filePath);
}

/**
 * Get status bar item text
 */
export function getStatusBarText(): string | undefined {
  // This is tricky - status bar items aren't easily accessible
  // We might need to expose this from the extension
  // For now, return undefined - we'll implement this later
  return undefined;
}

/**
 * VM config for E2E tests
 */
export const E2E_VM_CONFIG = {
  hostname: '127.0.0.1',
  port: 2222,
  username: 'centos',
  password: 'centos',
  remotePath: '/home/centos/test-e2e',
};