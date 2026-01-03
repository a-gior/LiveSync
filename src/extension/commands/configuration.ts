import * as vscode from 'vscode';
import { cmd } from '../cmd';
import { Services } from '../services';
import { ConfigurationPanel } from '../../presentation/webview/ConfigurationPanel';
import { ConfigWriter } from '../../infrastructure/config/ConfigWriter';

interface ConfigurationOptions {
  mode?: 'prompt' | 'ui' | 'json';
  folder?: vscode.WorkspaceFolder;
}

export function registerConfigurationCommands(services: Services): void {
  const { context } = services;

  // Main configuration command
  cmd(context, 'livesync.configuration', async (options?: ConfigurationOptions) => {
    // use optional chaining
    let mode: 'prompt' | 'ui' | 'json' = 
      options?.mode ?? 
      vscode.workspace.getConfiguration('livesync').get('openMode', 'prompt');
    
    let targetFolder = options?.folder;

    // Handle prompt mode
    if (mode === 'prompt') {
      const choice = await vscode.window.showQuickPick([
        { label: '$(gear) UI Panel', id: 'ui' as const },
        { label: '$(file-code) JSON', id: 'json' as const }
      ], {
        placeHolder: 'Edit via UI or JSON?'
      });

      if (!choice) return;
      mode = choice.id;
    }

    // Get target folder if not provided
    if (!targetFolder) {
      targetFolder = await pickTargetFolder();
      if (!targetFolder) return;
    }

    await ConfigWriter.ensureConfigExists(targetFolder);

    if (mode === 'ui') {
      ConfigurationPanel.show(context.extensionUri, services, targetFolder);
    } else {
      await openJsonConfig(targetFolder);
    }
  });

  // Refresh configuration panel (for development)
  cmd(context, 'livesync.refreshConfig', async () => {
    const folder = await pickTargetFolder();
    if (!folder) return;

    ConfigurationPanel.kill();
    ConfigurationPanel.show(context.extensionUri, services, folder);

    // Optional: Open dev tools after a short delay
    setTimeout(
      () => vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools'),
      500
    );
  });
}

async function pickTargetFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;

  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage('No workspace folder open');
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0];
  }

  const items = folders.map(f => ({
    label: f.name,
    description: f.uri.fsPath,
    folder: f
  }));

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select workspace folder to configure'
  });

  return choice?.folder;
}

async function openJsonConfig(folder: vscode.WorkspaceFolder): Promise<void> {
  const configPath = vscode.Uri.joinPath(
    folder.uri,
    '.vscode',
    'livesync.json'
  );

  try {
    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
  } catch (error: any) {
    void vscode.window.showErrorMessage(
      `Could not open config file: ${error.message}`
    );
  }
}