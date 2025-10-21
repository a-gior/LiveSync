import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceConfigData } from './WorkspaceConfig';

/**
 * Used by the Webview panel to update configuration files.
 * Utility for writing configuration updates to livesync.json files.
 * WorkspaceConfigService only reads configs; this handles writes.
 */
export class ConfigWriter {
  /**
   * Update specific fields in a workspace's livesync.json file
   */
  static async updateConfig(
    workspaceId: string,
    updates: Partial<WorkspaceConfigData>
  ): Promise<void> {
    const configPath = path.join(workspaceId, '.vscode', 'livesync.json');

    // Read existing config
    let existing: WorkspaceConfigData = {};
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      existing = JSON.parse(raw);
    } catch (err) {
      // File doesn't exist or is invalid - we'll create/overwrite it
    }

    // Merge updates
    const merged: WorkspaceConfigData = {
      ...existing,
      ...updates
    };

    // Write back
    await fs.writeFile(
      configPath,
      JSON.stringify(merged, null, 2),
      'utf8'
    );

    // WorkspaceConfigService (file watcher) detects change and reload it
  }

  /**
   * Create a default config file if it doesn't exist
   */
  static async ensureConfigExists(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const configPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'livesync.json');

    try {
      await fs.access(configPath);
      // File exists, nothing to do
    } catch {
      // File doesn't exist, create default
      const defaultConfig: WorkspaceConfigData = {
        hostname: '',
        port: 22,
        username: '',
        password: '',
        privateKeyPath: '',
        passphrase: '',
        remotePath: '',
        actionOnUpload: 'check&upload',
        actionOnDownload: 'check&download',
        actionOnSave: 'check&save',
        actionOnCreate: 'check&create',
        actionOnDelete: 'none',
        actionOnMove: 'check&move',
        actionOnOpen: 'check&download',
        ignoreList: ['.vscode', '.git', '.svn']
      };

      // Ensure .vscode directory exists
      const vscodePath = path.join(workspaceFolder.uri.fsPath, '.vscode');
      await fs.mkdir(vscodePath, { recursive: true });

      await fs.writeFile(
        configPath,
        JSON.stringify(defaultConfig, null, 2),
        'utf8'
      );
    }
  }
}