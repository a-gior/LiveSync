import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

function setWebviewContent(panel: vscode.WebviewPanel, htmlFilePath: string, cssFilePath: string, jsFilePath: string) {
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
}

export function createOrShowWebviewPanel(context: vscode.ExtensionContext) {
    const columnToShowIn = vscode.ViewColumn.One;
    const panel = vscode.window.createWebviewPanel(
        'yourWebviewPanelId',
        'Your Webview Title',
        columnToShowIn,
        {
            enableScripts: true
        }
    );

    const htmlFilePath = path.join(context.extensionPath, 'webviews/configuration', 'index.html');
    const cssFilePath = path.join(context.extensionPath, 'webviews/configuration', 'styles.css');
    const jsFilePath = path.join(context.extensionPath, 'webviews/configuration', 'script.js');

    setWebviewContent(panel, htmlFilePath, cssFilePath, jsFilePath);
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