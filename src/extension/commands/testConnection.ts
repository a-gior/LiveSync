import * as vscode from 'vscode';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import type { Services } from '../services';

/**
 * Registers the manual "Test Connection" command
 * This performs a full SSH authentication test (slow but thorough)
 * 
 * Can be called with either:
 * 1. A WorkspaceFolder (tests the saved config)
 * 2. Raw ConnectionSettings (tests without saving)
 */
export function registerTestConnectionCommand(services: Services): void {
  services.context.subscriptions.push(
    vscode.commands.registerCommand('livesync.testConnection', async (param?: vscode.WorkspaceFolder | any) => {
      let connectionSettings: any;

      // Determine if param is WorkspaceFolder or raw connection settings
      if (param && 'uri' in param && 'name' in param) {
        // It's a WorkspaceFolder - load saved config
        const folder = param as vscode.WorkspaceFolder;

        const config = await services.config.get(folder);
        
        if (!config.hasRemote) {
          vscode.window.showWarningMessage('No remote configuration found');
          return { success: false, message: 'No configuration' };
        }

        connectionSettings = {
          hostname: config.data.hostname!,
          port: config.data.port || 22,
          username: config.data.username || '',
          password: config.data.password,
          privateKeyPath: config.data.privateKeyPath,
          passphrase: config.data.passphrase,
        };
      } else if (param) {
        // It's raw connection settings - test without saving
        connectionSettings = param;
      } else {
        // No param - try to use first workspace
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          vscode.window.showErrorMessage('No workspace folder found');
          return { success: false, message: 'No workspace' };
        }

        const config = await services.config.get(folder);
        
        if (!config.hasRemote) {
          vscode.window.showWarningMessage('No remote configuration found');
          return { success: false, message: 'No configuration' };
        }

        connectionSettings = {
          hostname: config.data.hostname!,
          port: config.data.port || 22,
          username: config.data.username || '',
          password: config.data.password,
          privateKeyPath: config.data.privateKeyPath,
          passphrase: config.data.passphrase,
        };
      }

      // Validate settings
      if (!connectionSettings.hostname) {
        vscode.window.showErrorMessage('Hostname is required');
        return { success: false, message: 'Missing hostname' };
      }
      if (!connectionSettings.username) {
        vscode.window.showErrorMessage('Username is required');
        return { success: false, message: 'Missing username' };
      }
      if (!connectionSettings.password && !connectionSettings.privateKeyPath) {
        vscode.window.showErrorMessage('Password or private key is required');
        return { success: false, message: 'Missing authentication' };
      }

      // Test connection with progress
      const testResult = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Testing connection...',
          cancellable: false,
        },
        async () => await ConfigValidator.testConnection(connectionSettings)
      );

      if (testResult.success) {
        vscode.window.showInformationMessage(`✓ Connection successful to ${connectionSettings.hostname}:${connectionSettings.port || 22}`);
      } else {
        const message = testResult.details
          ? `✗ Connection failed: ${testResult.message}\n${testResult.details}`
          : `✗ Connection failed: ${testResult.message}`;
        vscode.window.showErrorMessage(message);
      }

      return testResult;
    })
  );
}