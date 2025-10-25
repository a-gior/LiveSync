import * as vscode from 'vscode';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import type { Services } from '../services';

/**
 * Registers the manual "Test Connection" command
 * This performs a full SSH authentication test (slow but thorough)
 */
export function registerTestConnectionCommand(services: Services): void {
  services.context.subscriptions.push(
    vscode.commands.registerCommand('livesync.testConnection', async (workspaceFolder?: vscode.WorkspaceFolder) => {
      // Use active workspace if not provided
      const folder = workspaceFolder ?? vscode.workspace.workspaceFolders?.[0];
      
      if (!folder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Testing connection to ${folder.name}...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: 'Loading configuration...' });
          
          const config = await services.config.get(folder);
          
          if (!config.hasRemote) {
            vscode.window.showWarningMessage('No remote configuration found');
            return;
          }

          progress.report({ increment: 30, message: 'Connecting to SSH server...' });

          // Perform full connection test with authentication
          const result = await ConfigValidator.testConnection({
            hostname: config.data.hostname!,
            port: config.data.port || 22,
            username: config.data.username || '',
            password: config.data.password,
            privateKeyPath: config.data.privateKeyPath,
            passphrase: config.data.passphrase,
          });

          progress.report({ increment: 100 });

          if (result.success) {
            const message = result.details 
              ? `✓ Connection successful to ${config.data.hostname}:${config.data.port || 22}\n${result.details}`
              : `✓ Connection successful to ${config.data.hostname}:${config.data.port || 22}`;
            vscode.window.showInformationMessage(message);
          } else {
            const message = result.details
              ? `✗ Connection failed: ${result.message}\n${result.details}`
              : `✗ Connection failed: ${result.message}`;
            vscode.window.showErrorMessage(message);
          }
        }
      );
    })
  );
}