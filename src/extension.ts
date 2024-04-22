// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WebviewManager } from './ui/webviewManager';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
    const webviewManager = WebviewManager.getInstance(context);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "livesync" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let helloWorldDisposable = vscode.commands.registerCommand('livesync.helloWorld', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from LiveSync!');
		const input = await vscode.window.showInputBox();
		if(input) {
			vscode.window.showInformationMessage(input);
		}
	});
	context.subscriptions.push(helloWorldDisposable);

	let configurationDisposable = vscode.commands.registerCommand('livesync.configuration', async () => {
		
		// Check if there are any workspace folders open
		if (vscode.workspace.workspaceFolders === undefined) {
			vscode.window.showErrorMessage('No workspace opened. This extension requires an open workspace.');
			return;
		}
		
		const panel = webviewManager.createOrShowConfigurationWebview();

	});
	context.subscriptions.push(configurationDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
