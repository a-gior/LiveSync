import * as vscode from 'vscode';
import * as path from 'path';
import { Client } from 'ssh2';
import * as fs from 'fs';
import { createOrShowWebviewPanel } from './../utils/webviewUtils';
import { ConfigurationMessage } from './DTOs/messages/configurationDTO';
import { ErrorsMessage } from './DTOs/messages/errorsDTO';
import { NotificationMessage } from './DTOs/messages/notificationDTO';
import { SFTPClient } from '../services/SFTPClient';

export class WebviewManager {
    private static _instance: WebviewManager | undefined;
    private _webviews: vscode.WebviewPanel[] = [];

    private constructor(private readonly _context: vscode.ExtensionContext) {}
    
    public static getInstance(context: vscode.ExtensionContext): WebviewManager {
        if (!WebviewManager._instance) {
            WebviewManager._instance = new WebviewManager(context);
        }
        return WebviewManager._instance;
    }

    public createOrShowConfigurationWebview(context: vscode.ExtensionContext): void {
        const viewType = 'configurationViewType';
        const title = 'Configuration';
        const htmlFilePath = path.join(this._context.extensionPath, 'webviews/configuration', 'index.html');
        const cssFilePath = path.join(this._context.extensionPath, 'webviews/configuration', 'styles.css');
        const jsFilePath = path.join(this._context.extensionPath, 'webviews/configuration', 'script.js');
    
        const configurationCallback = (message: ConfigurationMessage) => {
            switch (message.command) {
                case 'updateConfiguration':
                    console.log("UpdateConfiguration...");
                    this.updateConfiguration(message.configuration);
                    break;
                case 'testConnection':
                    console.log("TestConnection...");
                    this.testConnection(context, message.configuration, viewType);
                    break;
            }
        };

        // Initial state containing configuration values
        const config = vscode.workspace.getConfiguration('LiveSync');
        const defaultHostname = config.get<string>('hostname', '');
        const defaultPort = config.get<number>('port', 22);
        const defaultUsername = config.get<string>('username', '');
        const defaultAuthMethod = config.get<string>('authMethod', 'password');
        const defaultPassword = config.get<string>('password', '');
        const defaultSshKey = config.get<string>('sshKey', '');

        const initialState: ConfigurationMessage = {
            command: 'setInitialConfiguration',
            configuration: {
                hostname: defaultHostname,
                port: defaultPort,
                username: defaultUsername,
                authMethod: defaultAuthMethod,
                password: defaultPassword,
                sshKey: defaultSshKey
            }
        };

        const panel = createOrShowWebviewPanel(
            viewType,
            title,
            htmlFilePath,
            cssFilePath,
            jsFilePath,
            this._webviews,
            configurationCallback,
            initialState
        );
    }

    updateConfiguration(configuration: ConfigurationMessage['configuration']) {
        const config = vscode.workspace.getConfiguration('LiveSync');
        const { hostname, port, username, authMethod, password, sshKey } = configuration;

        config.update('hostname', hostname, vscode.ConfigurationTarget.Workspace);
        config.update('port', port, vscode.ConfigurationTarget.Workspace);
        config.update('username', username, vscode.ConfigurationTarget.Workspace);
        config.update('authMethod', authMethod, vscode.ConfigurationTarget.Workspace);
        config.update('password', password, vscode.ConfigurationTarget.Workspace);
        config.update('sshKey', sshKey, vscode.ConfigurationTarget.Workspace);

        console.log("Updated config: ", config);
    }

    async testConnection(context: vscode.ExtensionContext, configuration: ConfigurationMessage['configuration'], viewType: string): Promise<void> {
    
        // Function to connect via SSH
        function connectSSH(config: ConfigurationMessage['configuration']): void {
            const conn = new Client();
    
            conn.on('ready', () => {
                console.log('SSH Connection successful');
                conn.end();
            });
            conn.on('error', (err) => {
                console.error('Error connecting via SSH:', err);
            });
            conn.connect(config);
        }

        const { hostname, port, username, password } = configuration;
        // Test SSH connection
        // connectSSH(configuration);
    
        // Test SFTP connection
        //* Open the connection
        const client = new SFTPClient();
        await client.connect(configuration);

        const panel = this._webviews.find(panel => panel.viewType === viewType);
        const clientErrors = client.getErrors();
        if(clientErrors.length > 0) {
            if(panel) {
                // let errorsMsg: ErrorsMessage = {command: "error", errors: clientErrors};
                // panel.webview.postMessage(errorsMsg);
                vscode.window.showErrorMessage(clientErrors[0].error.message);
            } else {
                console.log("Couldnt find panel");
            }
        } else {
            if(panel) {
                // let notifMsg: NotificationMessage = {command: "showNotif", msg: "SSH connection successful."};
                // panel.webview.postMessage(notifMsg);
                vscode.window.showInformationMessage('Test Connection successful');
            } else {
                console.log("Couldnt find panel");
            }
        }

        // //* List working directory files
        // await client.listFiles(".");

        // //* Upload local file to remote file
        // await client.uploadFile("./local.txt", "./remote.txt");

        // //* Download remote file to local file
        // await client.downloadFile("./remote.txt", "./download.txt");

        // //* Delete remote file
        // await client.deleteFile("./remote.txt");

        //* Close the connection
        await client.disconnect();
    }
    
}
