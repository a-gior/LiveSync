/**
 * E2E Test Helpers
 * Common utilities for E2E testing
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * VM configuration for E2E tests
 */
export const E2E_VM_CONFIG = {
  hostname: '127.0.0.1',
  port: 2222,
  username: 'centos',
  password: 'centos',
  remotePath: '/home/centos/test-workspace',
  ignoreList: ['.vscode', '.livesync', '.git']
};

/**
 * Wait for condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  checkIntervalMs: number = 100
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }
  
  return false;
}

/**
 * Get workspace folder by path
 */
export function getWorkspaceFolder(workspacePath: string): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.find(
    folder => folder.uri.fsPath === workspacePath
  );
}

/**
 * Create LiveSync configuration file
 */
export async function createLiveSyncConfig(
  workspacePath: string,
  config?: Partial<typeof E2E_VM_CONFIG>
): Promise<string> {
  const configPath = path.join(workspacePath, '.vscode', 'livesync.json');
  const configData = { ...E2E_VM_CONFIG, ...config };
  
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(configData, null, 2));
  
  return configPath;
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
 * Create test file
 */
export async function createTestFile(
  workspacePath: string,
  relativePath: string,
  content: string
): Promise<string> {
  const filePath = path.join(workspacePath, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return filePath;
}

/**
 * Delete file
 */
export async function deleteFile(filePath: string): Promise<void> {
  await fs.unlink(filePath);
}

/**
 * Test SSH connection
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
        // Load private key
        const keyPath = config.privateKeyPath.replace(/^~/, process.env.HOME || '');
        fs.readFile(keyPath, 'utf-8')
          .then(privateKey => {
            connectConfig.privateKey = privateKey;
            if (config.passphrase) {
              connectConfig.passphrase = config.passphrase;
            }
            client.connect(connectConfig);
          })
          .catch(err => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({
                success: false,
                message: `Failed to read private key: ${err.message}`,
              });
            }
          });
      } else {
        connectConfig.password = config.password;
        client.connect(connectConfig);
      }
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
 * Wait for extension to be active
 */
export async function waitForExtension(
  extensionId: string = 'agior.livesync',
  timeoutMs: number = 10000
): Promise<vscode.Extension<any> | undefined> {
  const ext = vscode.extensions.getExtension(extensionId);
  if (!ext) {
    return undefined;
  }

  if (ext.isActive) {
    return ext;
  }

  // Wait for activation
  const activated = await waitFor(
    () => ext.isActive,
    timeoutMs
  );

  return activated ? ext : undefined;
}

/**
 * Get tree view visible state (best effort)
 */
export async function isTreeViewVisible(viewId: string): Promise<boolean> {
  // VSCode doesn't expose tree view visibility directly
  // This is a best-effort check
  try {
    await vscode.commands.executeCommand(`${viewId}.focus`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create multiple test files
 */
export async function createTestFiles(
  workspacePath: string,
  files: Array<{ path: string; content: string }>
): Promise<string[]> {
  const createdFiles: string[] = [];
  
  for (const file of files) {
    const filePath = await createTestFile(workspacePath, file.path, file.content);
    createdFiles.push(filePath);
  }
  
  return createdFiles;
}

/**
 * Clean up multiple files
 */
export async function cleanupTestFiles(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      console.warn(`Failed to cleanup ${filePath}:`, err);
    }
  }
}

/**
 * Get active editor file path
 */
export function getActiveEditorPath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

/**
 * Open file in editor
 */
export async function openFileInEditor(filePath: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(filePath);
  return await vscode.window.showTextDocument(doc);
}

/**
 * Close all editors
 */
export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/**
 * Get configuration value
 */
export function getConfig<T>(section: string, key: string, defaultValue: T): T {
  const config = vscode.workspace.getConfiguration(section);
  return config.get<T>(key, defaultValue);
}

/**
 * Set configuration value
 */
export async function setConfig(
  section: string,
  key: string,
  value: any,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
): Promise<void> {
  const config = vscode.workspace.getConfiguration(section);
  await config.update(key, value, target);
}

/**
 * Execute command and wait for completion
 */
export async function executeCommand<T = any>(
  command: string,
  ...args: any[]
): Promise<T | undefined> {
  try {
    return await vscode.commands.executeCommand<T>(command, ...args);
  } catch (err) {
    console.error(`Failed to execute command ${command}:`, err);
    return undefined;
  }
}

/**
 * Wait for file to be saved
 */
export async function waitForFileSave(
  doc: vscode.TextDocument,
  timeoutMs: number = 5000
): Promise<boolean> {
  if (!doc.isDirty) {
    return true;
  }

  return await waitFor(
    () => !doc.isDirty,
    timeoutMs
  );
}

/**
 * Create and save file with content
 */
export async function createAndSaveFile(
  workspacePath: string,
  relativePath: string,
  content: string
): Promise<vscode.TextDocument> {
  const filePath = await createTestFile(workspacePath, relativePath, content);
  const doc = await vscode.workspace.openTextDocument(filePath);
  const editor = await vscode.window.showTextDocument(doc);
  
  // Ensure it's saved
  if (doc.isDirty) {
    await doc.save();
  }
  
  return doc;
}