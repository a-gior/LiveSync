// src/storage/WorkspacePrefs.ts
import * as vscode from "vscode";
import { LAST_SELECTED_WORKSPACE_KEY } from "../utilities/constants";

let ctx: vscode.ExtensionContext | undefined;

export function initLastSelectedWorkspace(context: vscode.ExtensionContext) {
  ctx = context;
}

export function getLastSelectedWorkspace(): vscode.WorkspaceFolder {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    throw new Error("No workspace is open.");
  }

  const savedUri = ctx?.workspaceState.get<string>(LAST_SELECTED_WORKSPACE_KEY);

  if (savedUri) {
    const match = vscode.workspace.workspaceFolders.find(
      f => f.uri.toString() === savedUri
    );
    if (match) {
      return match;
    }
  }

  return vscode.workspace.workspaceFolders[0];
}

export async function setLastSelectedWorkspace(folder: vscode.WorkspaceFolder): Promise<void> {
  await ctx?.workspaceState.update(LAST_SELECTED_WORKSPACE_KEY, folder.uri.toString());
}
