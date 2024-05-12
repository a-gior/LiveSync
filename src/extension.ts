// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { HelloWorldPanel } from "./panels/HelloWorldPanel";
import { ConfigurationPanel } from "./panels/ConfigurationPanel";
import { PairedFoldersTreeDataProvider } from "./services/PairedFoldersTreeDataProvider";
import { JsonOutlineProvider } from "./services/JsonOutlineProvider";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  console.log('Congratulations, your extension "livesync" is now active!');

  const nodeDependenciesProvider = new PairedFoldersTreeDataProvider();
  vscode.window.registerTreeDataProvider(
    "nodeDependencies",
    nodeDependenciesProvider,
  );

  let refreshDisposable = vscode.commands.registerCommand(
    "livesync.refreshConfig",
    () => {
      ConfigurationPanel.kill();
      ConfigurationPanel.render(context.extensionUri);
      vscode.commands.executeCommand(
        "workbench.action.webview.openDeveloperTools",
      );
    },
  );
  context.subscriptions.push(refreshDisposable);

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

      console.log("Rendering Configuration Panel", context.extensionUri);
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
