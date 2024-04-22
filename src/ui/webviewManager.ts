import * as vscode from 'vscode';
import * as path from 'path';
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
                    const config = vscode.workspace.getConfiguration('LiveSync');
                    config.update('hostname', message.configuration.hostname, vscode.ConfigurationTarget.Workspace);
                    config.update('port', message.configuration.port, vscode.ConfigurationTarget.Workspace);
                    config.update('username', message.configuration.username, vscode.ConfigurationTarget.Workspace);
                    config.update('password', message.configuration.password, vscode.ConfigurationTarget.Workspace);
                    config.update('sshKey', message.configuration.sshKey, vscode.ConfigurationTarget.Workspace);
                    console.log(message, config);
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
}
