// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { WebviewManager } from "./ui/webviewManager";
import { HelloWorldPanel } from "./panels/HelloWorldPanel";
import { ConfigurationPanel } from "./panels/ConfigurationPanel";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const webviewManager = WebviewManager.getInstance(context);

  console.log('Congratulations, your extension "livesync" is now active!');

  let helloWorldDisposable = vscode.commands.registerCommand(
    "livesync.helloWorld",
    async () => {
      vscode.window.showInformationMessage("Hello World from LiveSync!");
      const input = await vscode.window.showInputBox();
      if (input) {
        vscode.window.showInformationMessage(input);
      }
    },
  );
  context.subscriptions.push(helloWorldDisposable);

  let configurationDisposable = vscode.commands.registerCommand(
    "livesync.configuration",
    () => {
      // Check if there are any workspace folders open
      if (vscode.workspace.workspaceFolders === undefined) {
        vscode.window.showErrorMessage(
          "No workspace opened. This extension requires an open workspace.",
        );
        return;
      }

      console.log("Rendering Configuration Panel");
      ConfigurationPanel.render(context.extensionUri);
    },
  );
  context.subscriptions.push(configurationDisposable);

  const svelteHelloWorldDisposable = vscode.commands.registerCommand(
    "livesync.showHelloWorld",
    () => {
      console.log("Testing render");
      HelloWorldPanel.render(context.extensionUri);
    },
  );
  context.subscriptions.push(svelteHelloWorldDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
