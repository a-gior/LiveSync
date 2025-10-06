import * as vscode from 'vscode';
import { toRelativeFsPath } from '@infra/persistence/LocalIndexBuilder';

export function getWorkspaceFolderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  const folders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (uri.fsPath.startsWith(folder.uri.fsPath)) {
      return folder;
    }
  }
  return undefined;
}

export function getWorkspaceId(folder: vscode.WorkspaceFolder): string {
  return folder.uri.fsPath;
}

export function getRelativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  return toRelativeFsPath(folder, uri.fsPath);
}
