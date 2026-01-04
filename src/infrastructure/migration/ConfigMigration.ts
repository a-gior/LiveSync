import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { WorkspaceConfigData } from '@infra/config/WorkspaceConfig';

/**
 * Detects and migrates old v1.0.9 configuration from .vscode/settings.json
 * to the new .vscode/livesync.json format
 */
export async function migrateOldConfig(folder: vscode.WorkspaceFolder): Promise<boolean> {
  const configPath = path.join(folder.uri.fsPath, '.vscode', 'livesync.json');
  
  // Skip if new config already exists
  try {
    await fsp.access(configPath);
    return false; // Already migrated
  } catch {
    // No new config, check for old one
  }

  const config = vscode.workspace.getConfiguration('LiveSync', folder.uri);
  const hostname = config.get<string>('hostname');
  
  // No old config found
  if (!hostname) {
    return false;
  }

  // Build new config from old settings
  const newConfig: WorkspaceConfigData = {
    hostname: config.get<string>('hostname') ?? '',
    port: config.get<number>('port') ?? 22,
    username: config.get<string>('username') ?? '',
    password: config.get<string>('password') ?? '',
    privateKeyPath: config.get<string>('privateKeyPath') ?? '',
    passphrase: config.get<string>('passphrase') ?? '',
    remotePath: config.get<string>('remotePath') ?? '',
    actionOnUpload: config.get<string>('actionOnUpload') ?? 'check&upload',
    actionOnDownload: config.get<string>('actionOnDownload') ?? 'check&download',
    actionOnSave: config.get<string>('actionOnSave') ?? 'check&save',
    actionOnCreate: config.get<string>('actionOnCreate') ?? 'check&create',
    actionOnDelete: config.get<string>('actionOnDelete') ?? 'none',
    actionOnMove: config.get<string>('actionOnMove') ?? 'check&move',
    actionOnOpen: config.get<string>('actionOnOpen') ?? 'check&download',
    ignoreList: config.get<string[]>('ignoreList') ?? ['.vscode', '.git', '.svn', '.livesync']
  };

  // Write new config
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');

  return true;
}

/**
 * Clean up old settings from .vscode/settings.json
 * If settings.json only contained LiveSync settings, delete the entire file
 * If .vscode directory becomes empty, delete it too
 */
export async function cleanupOldSettings(folder: vscode.WorkspaceFolder): Promise<void> {
  const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');
  
  // Check if settings.json exists
  let settingsContent: any;
  try {
    const raw = await fsp.readFile(settingsPath, 'utf-8');
    settingsContent = JSON.parse(raw);
  } catch {
    // File doesn't exist or invalid JSON - nothing to clean
    return;
  }

  // Remove all LiveSync.* keys
  const oldKeys = [
    'LiveSync.hostname', 'LiveSync.port', 'LiveSync.username', 'LiveSync.password', 
    'LiveSync.privateKeyPath', 'LiveSync.passphrase', 'LiveSync.remotePath', 
    'LiveSync.actionOnUpload', 'LiveSync.actionOnDownload', 'LiveSync.actionOnSave',
    'LiveSync.actionOnCreate', 'LiveSync.actionOnDelete', 'LiveSync.actionOnMove', 
    'LiveSync.actionOnOpen', 'LiveSync.ignoreList'
  ];

  for (const key of oldKeys) {
    delete settingsContent[key];
  }

  // If settings.json is now empty, delete the file
  const remainingKeys = Object.keys(settingsContent);
  if (remainingKeys.length === 0) {
    await fsp.unlink(settingsPath);
    
    // Check if .vscode directory is now empty and delete if so
    try {
      const dirContents = await fsp.readdir(vscodeDir);
      if (dirContents.length === 0) {
        await fsp.rmdir(vscodeDir);
      }
    } catch {
      // Directory not empty or other error - leave it
    }
  } else {
    // Write back the cleaned settings
    await fsp.writeFile(settingsPath, JSON.stringify(settingsContent, null, 2), 'utf-8');
  }
}

/**
 * Clean up old cache files from extension storage (v1.0.9 stored in globalStorage/workspaceStorage)
 */
export async function cleanupOldCache(context: vscode.ExtensionContext): Promise<void> {
  // Old v1.0.9 stored cache in workspace storage
  const oldCacheFiles = [
    'remoteFiles.json',
    'compareFiles.json', 
    'foldersState.json'
  ];

  for (const filename of oldCacheFiles) {
    const oldPath = path.join(context.storageUri?.fsPath ?? '', filename);
    try {
      await fsp.unlink(oldPath);
    } catch {
      // File doesn't exist or already deleted
    }
  }

  // Also try global storage (in case it was stored there)
  for (const filename of oldCacheFiles) {
    const oldPath = path.join(context.globalStorageUri?.fsPath ?? '', filename);
    try {
      await fsp.unlink(oldPath);
    } catch {
      // File doesn't exist or already deleted
    }
  }
}

/**
 * Run migration for all workspace folders and notify user
 */
export async function runMigrationCheck(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {return;}

  const migrated: string[] = [];

  for (const folder of folders) {
    const wasMigrated = await migrateOldConfig(folder);
    if (wasMigrated) {
      migrated.push(folder.name);
    }
  }

  if (migrated.length === 0) {return;}

  // Show notification
  const message = migrated.length === 1
    ? `LiveSync: Configuration updated for "${migrated[0]}". Settings are now in .vscode/livesync.json`
    : `LiveSync: Updated ${migrated.length} workspace(s). Settings are now in .vscode/livesync.json`;

  const choice = await vscode.window.showInformationMessage(
    message + ". Do you want to clean up old settings?",
    'Yes',
    'Dismiss'
  );

  if (choice === 'Yes') {
    // Clean settings from .vscode/settings.json
    for (const folder of folders) {
      if (migrated.includes(folder.name)) {
        await cleanupOldSettings(folder);
      }
    }
    
    // Clean old cache files from extension storage
    await cleanupOldCache(context);
    
    void vscode.window.showInformationMessage('LiveSync: Old settings and cache cleaned up');
  }
}