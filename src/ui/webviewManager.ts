import * as vscode from 'vscode';
import * as path from 'path';
import { Client } from 'ssh2';
import { createOrShowWebviewPanel } from './../utils/webviewUtils';
import { ConfigurationMessage } from './DTOs/configurationDTO';

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

    public createOrShowConfigurationWebview(): void {
        const viewType = 'configurationViewType';
        const title = 'Configuration';
        const htmlFilePath = path.join(this._context.extensionPath, 'webviews/configuration', 'index.html');
        const cssFilePath = path.join(this._context.extensionPath, 'webviews/configuration', 'styles.css');
        const jsFilePath = path.join(this._context.extensionPath, 'webviews/configuration', 'script.js');
    
        const configurationCallback = (message: ConfigurationMessage) => {
            switch (message.command) {
                case 'updateConfiguration':
                    this.updateConfiguration(message.configuration);
                    break;
                case 'testConnection':
                    console.log("TestConnection...");
                    this.testConnection(message.configuration);
                    break;
            }
        };
        // Initial state containing configuration values
        const config = vscode.workspace.getConfiguration('LiveSync');
        const defaultHostname = config.get<string>('hostname', '');
        const defaultPort = config.get<number>('port', 22);
        const defaultUsername = config.get<string>('username', '');
        const defaultPassword = config.get<string>('password', '');
        const defaultSshKey = config.get<string>('sshKey', '');

        const initialState: ConfigurationMessage = {
            command: 'setInitialConfiguration',
            configuration: {
                hostname: defaultHostname,
                port: defaultPort,
                username: defaultUsername,
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
        const { hostname, port, username, password, sshKey } = configuration;

        config.update('hostname', hostname, vscode.ConfigurationTarget.Workspace);
        config.update('port', port, vscode.ConfigurationTarget.Workspace);
        config.update('username', username, vscode.ConfigurationTarget.Workspace);
        config.update('password', password, vscode.ConfigurationTarget.Workspace);
        config.update('sshKey', sshKey, vscode.ConfigurationTarget.Workspace);

        console.log("Updated config: ", config);
    }

    async testConnection(configuration: ConfigurationMessage['configuration']) {
        const { hostname, port } = configuration;
        const url = `http://${hostname}:${port}/api/users`;
    
        try {
            const response = await fetch(url);
            if (response.ok) {
                console.log('Connection successful');
            } else {
                console.error('Error connecting:', response.statusText);
            }
        } catch (error) {
            console.error('Error connecting:', error);
        }
    }
    
}
