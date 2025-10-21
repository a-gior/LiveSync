import * as vscode from 'vscode';
import * as path from 'path';
import { Services } from '@ext/services';
import { ConfigWriter } from '@infra/config/ConfigWriter';
import { getNonce, getUri } from '@infra/helpers/webview';
import { stringToWsId } from '@infra/helpers/path';
import { ConfigValidator } from '@infra/config/ConfigValidator';

export class ConfigurationPanel {
  private static currentPanel?: ConfigurationPanel;
  private readonly panel: vscode.WebviewPanel;
  private readonly services: Services;
  private workspaceFolder: vscode.WorkspaceFolder;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    services: Services,
    workspaceFolder: vscode.WorkspaceFolder
  ) {
    this.panel = panel;
    this.services = services;
    this.workspaceFolder = workspaceFolder;

    // Set HTML content
    this.panel.webview.html = this.getWebviewContent(
      this.panel.webview,
      extensionUri
    );

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      undefined,
      this.disposables
    );

    // Handle panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Send initial configuration
    void this.sendInitialConfiguration();
  }

  public static show(
    extensionUri: vscode.Uri,
    services: Services,
    folder: vscode.WorkspaceFolder
  ): void {
    const viewType = 'livesync.configurationPanel';
    const title = 'LiveSync Configuration';

    // If panel already exists, reveal it
    if (ConfigurationPanel.currentPanel) {
      ConfigurationPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      // Update workspace folder if different
      if (ConfigurationPanel.currentPanel.workspaceFolder.uri.fsPath !== folder.uri.fsPath) {
        ConfigurationPanel.currentPanel.workspaceFolder = folder;
        void ConfigurationPanel.currentPanel.sendInitialConfiguration();
      }
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

    private async testConnection(connectionSettings: any): Promise<void> {
        
        try {
            const result = await ConfigValidator.testConnection({
            hostname: connectionSettings.hostname || '',
            port: connectionSettings.port || 22,
            username: connectionSettings.username || '',
            password: connectionSettings.password,
            privateKeyPath: connectionSettings.privateKeyPath,
            passphrase: connectionSettings.passphrase
            });

            if (result.success) {
                void vscode.window.showInformationMessage(result.message);
            } else {
                const detailsMsg = result.details ? `\n\n${result.details}` : '';
                void vscode.window.showErrorMessage(`${result.message}${detailsMsg}`);
            }

            // Send result back to webview
            this.panel.webview.postMessage({
                command: 'testConnectionResult',
                success: result.success,
                message: result.message,
                details: result.details
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
    const nonce = getNonce();

    const filepaths = [
      'resources/css/reset.css',
      'resources/css/vscode.css',
      'webview-ui/public/build/pages/configuration/configuration.css',
      'webview-ui/public/build/pages/configuration/configuration.js'
    ];

    let htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>LiveSync Configuration</title>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    `;

    // Add CSS and JS files
    filepaths.forEach((filepath) => {
      const uri = getUri(webview, extensionUri, filepath.split('/'));
      const extension = path.extname(filepath).toLowerCase();

      if (extension === '.css') {
        htmlContent += `\n<link rel="stylesheet" type="text/css" href="${uri}">`;
      } else if (extension === '.js') {
        htmlContent += `\n<script defer nonce="${nonce}" src="${uri}"></script>`;
      }
    });

    htmlContent += `\n</head>\n<body>\n</body>\n</html>`;

    return htmlContent;
  }
}