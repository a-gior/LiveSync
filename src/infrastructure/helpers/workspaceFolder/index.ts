import * as vscode from 'vscode';
import { WorkspaceId } from '@domain/types';

/**
 * Find a workspace folder by its WorkspaceId (which is the fsPath)
 */
export function findWorkspaceFolderById(workspaceId: WorkspaceId): vscode.WorkspaceFolder {
  const folder = vscode.workspace.workspaceFolders?.find(
    f => f.uri.fsPath === workspaceId
  );

  if(!folder) {
    throw new Error(`Workspace folder not found for id: ${workspaceId}`);
  }

  return folder;
}