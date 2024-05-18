// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ConfigurationPanel } from "./panels/ConfigurationPanel";
import { PairedFoldersTreeDataProvider } from "./services/PairedFoldersTreeDataProvider";
import { FileStatusDecorationProvider } from "./services/FileDecorationProvider";
import { FileEntry } from "src/utilities/FileEntry";
import { showDiff } from "./utilities/fileUtils/fileDiff";
import { handleFileSave } from "./utilities/fileUtils/fileSave";
import { file } from "tmp";

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
  const fileStatusDecorationProvider = new FileStatusDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileStatusDecorationProvider),
  );

  let refreshDisposable = vscode.commands.registerCommand(
    "livesync.refreshConfig",
    () => {
      ConfigurationPanel.kill();
      ConfigurationPanel.render(context.extensionUri);

      setTimeout(async () => {
        await vscode.commands.executeCommand(
          "workbench.action.webview.openDeveloperTools",
        );
      }, 500);
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

      ConfigurationPanel.render(context.extensionUri);
    },
  );
  context.subscriptions.push(configurationDisposable);

  context.subscriptions.push(
    vscode.commands.registerCommand("livesync.fileEntryRefresh", () => {
      nodeDependenciesProvider.refresh();
    }),
    vscode.commands.registerCommand(
      "livesync.fileEntryShowDiff",
      (fileEntry: FileEntry) => {
        vscode.window.showInformationMessage(
          `Comparing files for ${fileEntry.name}`,
        );

        showDiff(fileEntry);
      },
    ),
  );

  // Listen for configuration changes
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("LiveSync.actionOnSave")) {
      const config = vscode.workspace.getConfiguration("LiveSync");
      const actionOnSave = config.get<string>("actionOnSave");
      vscode.window.showInformationMessage(
        `actionOnSave is now set to ${actionOnSave}`,
      );
    }
  });

  // Listen for file save events
  vscode.workspace.onDidSaveTextDocument((document) => {
    handleFileSave(document);
  });
}

// This method is called when your extension is deactivated
export function deactivate() {}
