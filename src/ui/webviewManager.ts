import * as vscode from 'vscode';
import * as path from 'path';
import { createOrShowWebviewPanel } from './../utils/webviewUtils';

export class WebviewManager {
    private static _instance: WebviewManager | undefined;

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

        createOrShowWebviewPanel(this._context, viewType, title, htmlFilePath, cssFilePath, jsFilePath);
    }

    // Add additional methods for managing webviews as needed
}
