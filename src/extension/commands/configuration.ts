import * as vscode from 'vscode';
import { cmd } from '../cmd';
import { Services } from '../services';
import { ConfigurationPanel } from '../../presentation/webview/ConfigurationPanel';
import { ConfigWriter } from '../../infrastructure/config/ConfigWriter';

export function registerConfigurationCommands(services: Services): void {
  const { context } = services;

  // Main configuration command
  cmd(context, 'livesync.configuration', async () => {
    const mode = vscode.workspace
      .getConfiguration('livesync')
      .get<'prompt' | 'ui' | 'json'>('openMode', 'prompt');

    let selectedMode = mode;

    if (mode === 'prompt') {
      const items = [
        { label: '$(gear) UI Panel', id: 'ui' as const },
        { label: '$(file-code) JSON', id: 'json' as const }
      ];

      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: 'Edit via UI or JSON?'
      });

      if (!choice) return;
      selectedMode = choice.id;
    }

    // Get target workspace folder
    const folder = await pickTargetFolder();
    if (!folder) return;

    // Ensure config file exists
    await ConfigWriter.ensureConfigExists(folder);

    if (selectedMode === 'ui') {
      ConfigurationPanel.show(context.extensionUri, services, folder);
    } else {
      await openJsonConfig(folder);
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