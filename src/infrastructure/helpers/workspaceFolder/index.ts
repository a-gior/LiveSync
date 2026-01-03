import * as vscode from 'vscode';
import { RelPath, WorkspaceId } from '@domain/types';
import { pathToString, stringToWsId } from '../path';

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

/** Return the WorkspaceId for a given workspace folder */
export function getWorkspaceId(folder: vscode.WorkspaceFolder): WorkspaceId {
  return stringToWsId(folder.uri.fsPath);
}

export function getFolderLabel(workspaceId: WorkspaceId, folderPath: RelPath): string {
  const pathStr = pathToString(folderPath);
  
  if (!pathStr) {
    // Empty path = workspace root, use workspace name
    const folder = findWorkspaceFolderById(workspaceId);
    return folder.name;
  }
  
  return pathStr;
}