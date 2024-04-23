import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigurationMessage } from '../ui/DTOs/configurationDTO';

type ConfigurationCallbackFunction = (message: ConfigurationMessage) => void;

function readHTMLFile(filePath: string): string | undefined {
    try {
        const htmlContent = fs.readFileSync(filePath, 'utf8');
        return htmlContent;
    } catch (error) {
        console.error(`Error reading HTML file: ${error}`);
        return undefined;
    }
}

function readTextFile(filePath: string): string | undefined {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return fileContent;
    } catch (error) {
        console.error(`Error reading text file: ${error}`);
        return undefined;
    }
}

function setWebviewContent(panel: vscode.WebviewPanel, htmlFilePath: string, cssFilePath: string, jsFilePath: string): vscode.WebviewPanel {
    const htmlContent = readHTMLFile(htmlFilePath);
    const cssContent = readTextFile(cssFilePath);
    const jsContent = readTextFile(jsFilePath);

    if (htmlContent) {
        let finalHtmlContent = htmlContent;
        if (cssContent) {
            finalHtmlContent = finalHtmlContent.replace('</head>', `<style>${cssContent}</style></head>`);
        }
        if (jsContent) {
            finalHtmlContent = finalHtmlContent.replace('</body>', `<script>${jsContent}</script></body>`);
        }
        panel.webview.html = finalHtmlContent;
    } else {
        vscode.window.showErrorMessage('Failed to load HTML content for webview panel.');
    }

    return panel;
}

function createWebviewPanel(viewType: string, title: string, htmlFilePath: string, cssFilePath: string, jsFilePath: string): vscode.WebviewPanel {
    const columnToShowIn = vscode.ViewColumn.One;
    const panel = vscode.window.createWebviewPanel(
        viewType,
        title,
        columnToShowIn,
        {
            enableScripts: true
        }
    );

    setWebviewContent(panel, htmlFilePath, cssFilePath, jsFilePath);

    return panel;
}

export function createOrShowWebviewPanel(
    viewType: string,
    title: string,
    htmlFilePath: string,
    cssFilePath: string,
    jsFilePath: string,
    webviews: vscode.WebviewPanel[],
    postMessageCallback?: ConfigurationCallbackFunction,
    initialState?: any
): vscode.WebviewPanel {
    // Check if the panel already exists
    const panel = webviews.find(panel => panel.viewType === viewType);
    if (panel) {
        // Show the existing panel

        panel.reveal(vscode.ViewColumn.One);

        // Pass initial state to the webview
        if (initialState) {
            panel.webview.postMessage(initialState);
        }
        
        return panel;
    } else {
        // Create a new webview panel
        const panel = createWebviewPanel(viewType, title, htmlFilePath, cssFilePath, jsFilePath);
        webviews.push(panel);

        // Handle disposal of the panel
        panel.onDidDispose(() => {
            const index = webviews.indexOf(panel);
            if (index !== -1) {
                webviews.splice(index, 1);
            }
        });

        // Set function to be called if message is recieved
        if(postMessageCallback) {
            panel.webview.onDidReceiveMessage(postMessageCallback);
        }

        // Pass initial state to the webview
        if (initialState) {
            panel.webview.postMessage(initialState);
        }
        return panel;
    }

}

export function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		// Enable javascript in the webview
		enableScripts: true,

		// And restrict the webview to only loading content from our extension's `webviews` directory.
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webviews')]
	};
}