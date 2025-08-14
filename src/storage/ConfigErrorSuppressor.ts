// storage/ConfigErrorSuppressor.ts
import * as vscode from "vscode";
import { KEY } from "../utilities/constants";

let ctx: vscode.ExtensionContext | undefined;

export function initConfigErrorSuppressor(context: vscode.ExtensionContext) {
  ctx = context;
}

export function isConfigErrorSuppressed(folder: vscode.WorkspaceFolder): boolean {
  const list = ctx?.workspaceState.get<string[]>(KEY, []) ?? [];
  return list.includes(folder.uri.toString());
}

export async function suppressConfigError(folder: vscode.WorkspaceFolder): Promise<void> {
  if (!ctx) {return;}
  const list = ctx.workspaceState.get<string[]>(KEY, []) ?? [];
  const uri = folder.uri.toString();
  if (!list.includes(uri)) {
    list.push(uri);
    await ctx.workspaceState.update(KEY, list);
  }
}

export async function clearSuppressedConfigError(folder: vscode.WorkspaceFolder): Promise<void> {
  if (!ctx) {return;}
  const list = ctx.workspaceState.get<string[]>(KEY, []) ?? [];
  const updated = list.filter(u => u !== folder.uri.toString());
  await ctx.workspaceState.update(KEY, updated);
}

export async function clearAllSuppressedConfigErrors(): Promise<void> {
  if (!ctx) {return;}
  await ctx.workspaceState.update(KEY, []);
}
