import * as vscode from 'vscode';
import { stringToWsId } from '@helpers/path';
import { ConfigWriter } from '@infra/config/ConfigWriter';
import type { Services } from '../../extension/services';

export class ConfigurationPanel {
  public static currentPanel: ConfigurationPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly services: Services,
    private workspaceFolder: vscode.WorkspaceFolder
  ) {
    this.panel = panel;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.html = this.getWebviewContent(this.panel.webview, extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );
  }

  public static show(
    extensionUri: vscode.Uri,
    services: Services,
    folder: vscode.WorkspaceFolder
  ): void {
    const viewType = 'livesync.configurationPanel';
    const title = `LiveSync Configuration - ${folder.name}`;

    // If panel already exists, just reveal it
    if (ConfigurationPanel.currentPanel) {
      ConfigurationPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      ConfigurationPanel.currentPanel.workspaceFolder = folder;
      void ConfigurationPanel.currentPanel.sendInitialConfiguration();
      return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'out'),
          vscode.Uri.joinPath(extensionUri, 'resources'),
          vscode.Uri.joinPath(extensionUri, 'webview-ui/public/build')
        ],
        retainContextWhenHidden: true
      }
    );

    ConfigurationPanel.currentPanel = new ConfigurationPanel(
      panel,
      extensionUri,
      services,
      folder
    );

    // Send initial configuration after panel is created
    void ConfigurationPanel.currentPanel.sendInitialConfiguration();
  }

  public static kill(): void {
    ConfigurationPanel.currentPanel?.dispose();
  }

  private dispose(): void {
    ConfigurationPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'updateConfiguration':
        await this.updateConfiguration(message);
        break;

      case 'testConnection':
        await this.testConnection(message.configuration);
        break;

      case 'loadConfig':
        await this.sendInitialConfiguration();
        break;
    }
  }

  private async updateConfiguration(message: any): Promise<void> {
    const workspaceId = this.workspaceFolder.uri.fsPath;

    try {
      const updates: any = {};

      // Connection settings
      if (message.configuration) {
        Object.assign(updates, {
          hostname: message.configuration.hostname,
          port: message.configuration.port,
          username: message.configuration.username,
          password: message.configuration.password,
          privateKeyPath: message.configuration.privateKeyPath,
          passphrase: message.configuration.passphrase
        });
      }

      // Remote path
      if (message.remotePath !== undefined) {
        updates.remotePath = message.remotePath;
      }

      // File event actions
      if (message.fileEventActions) {
        Object.assign(updates, {
          actionOnUpload: message.fileEventActions.actionOnUpload,
          actionOnDownload: message.fileEventActions.actionOnDownload,
          actionOnSave: message.fileEventActions.actionOnSave,
          actionOnCreate: message.fileEventActions.actionOnCreate,
          actionOnDelete: message.fileEventActions.actionOnDelete,
          actionOnMove: message.fileEventActions.actionOnMove,
          actionOnOpen: message.fileEventActions.actionOnOpen
        });
      }

      // Ignore list
      if (message.ignoreList) {
        updates.ignoreList = message.ignoreList;
      }

      // Write the updates
      await ConfigWriter.updateConfig(workspaceId, updates);

      // WorkspaceConfigService will automatically reload via file watcher
      void vscode.window.showInformationMessage('Configuration saved successfully!');

    } catch (error: any) {
      void vscode.window.showErrorMessage(
        `Failed to save configuration: ${error.message}`
      );
    }
  }

  /**
   * Test connection using the registered command
   * This tests the connection WITHOUT saving the config first
   */
  private async testConnection(connectionSettings: any): Promise<void> {
    try {
      // Call the command with raw connection settings (no saving required)
      const result = await vscode.commands.executeCommand('livesync.testConnection', {
        hostname: connectionSettings.hostname,
        port: connectionSettings.port || 22,
        username: connectionSettings.username,
        password: connectionSettings.password,
        privateKeyPath: connectionSettings.privateKeyPath,
        passphrase: connectionSettings.passphrase,
      });
      
      // Send result back to webview
      this.panel.webview.postMessage({
        command: 'testConnectionResult',
        success: (result as any)?.success ?? false,
        message: (result as any)?.message ?? 'Test completed',
        details: (result as any)?.details
      });
      
    } catch (error: any) {
      void vscode.window.showErrorMessage(`Connection test failed: ${error.message}`);
      
      this.panel.webview.postMessage({
        command: 'testConnectionResult',
        success: false,
        message: 'Test failed',
        details: error.message
      });
    }
  }

  private async sendInitialConfiguration(): Promise<void> {
    const { config } = this.services;
    const workspaceId = stringToWsId(this.workspaceFolder.uri.fsPath);

    try {
      const wsConfig = await config.getById(workspaceId);
      const { data } = wsConfig;

      const message = {
        command: 'setInitialConfiguration',
        configuration: {
          hostname: data.hostname || '',
          port: data.port || 22,
          username: data.username || '',
          password: data.password || '',
          privateKeyPath: data.privateKeyPath || '',
          passphrase: data.passphrase || ''
        },
        remotePath: data.remotePath || '',
        fileEventActions: {
          actionOnUpload: data.actionOnUpload || 'check&upload',
          actionOnDownload: data.actionOnDownload || 'check&download',
          actionOnSave: data.actionOnSave || 'check&save',
          actionOnCreate: data.actionOnCreate || 'check&create',
          actionOnDelete: data.actionOnDelete || 'none',
          actionOnMove: data.actionOnMove || 'check&move',
          actionOnOpen: data.actionOnOpen || 'check&download'
        },
        ignoreList: data.ignoreList || ['.vscode', '.git', '.svn'],
        workspaceFolders: vscode.workspace.workspaceFolders?.map(f => ({
          uri: f.uri.toString(),
          name: f.name,
          index: f.index
        })) || [],
        selectedFolder: {
          uri: this.workspaceFolder.uri.toString(),
          name: this.workspaceFolder.name,
          index: this.workspaceFolder.index
        }
      };

      this.panel.webview.postMessage(message);
    } catch (error: any) {
      console.error('Failed to load configuration:', error);
    }
  }

  private getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
  ): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'webview-ui', 'public', 'build', 'pages', 'configuration', 'configuration.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'webview-ui', 'public', 'build', 'pages', 'configuration', 'configuration.css')
    );
    
    // Add reset CSS and VSCode theme CSS
    const resetCss = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'resources', 'css', 'reset.css')
    );
    const vscodeCss = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'resources', 'css', 'vscode.css')
    );

    // Generate a nonce for inline scripts (CSP)
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <link href="${resetCss}" rel="stylesheet">
        <link href="${vscodeCss}" rel="stylesheet">
        <link href="${styleUri}" rel="stylesheet">
        <title>LiveSync Configuration</title>
      </head>
      <body>
        <div id="app"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}