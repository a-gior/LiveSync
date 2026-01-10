import * as vscode from 'vscode';
import type { WorkspaceId, RelPath } from '../../../domain/types';
import { asRel, relFromAbs } from '../path/RelPath';
import { stringToWsId } from '../path';
import { findWorkspaceFolderById } from '../workspaceFolder';

export interface ResolvedTarget {
  workspaceId: WorkspaceId;
  relPath: RelPath;
}

export interface EntryNodeArg {
  kind: 'entry';
  workspaceId: WorkspaceId | string; // tree may pass plain string, we’ll brand it
  path?: RelPath | string;
  paths?: Array<RelPath | string>;   // optional [old, new] for move flows
}

function asUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) { return arg; }
  if (arg && typeof arg === 'object' && (arg as any).resourceUri instanceof vscode.Uri) {
    return (arg as any).resourceUri as vscode.Uri;
  }
  return undefined;
}

/**
 * Resolve a single entry target (Tree node, Explorer/Editor URI, or active editor).
 * - For Tree nodes, prefers `node.path` (ignores `paths[]`).
 * - Returns undefined if the file is outside any workspace.
 */
export function resolveEntryTarget(arg?: unknown, opts?: { allowActiveEditor?: boolean }): ResolvedTarget | undefined {
  // 1) Tree node
  if (arg && typeof arg === 'object' && (arg as any).kind === 'entry') {
    const node = arg as EntryNodeArg;
    const ws: WorkspaceId = stringToWsId(typeof node.workspaceId === 'string' ? node.workspaceId : (node.workspaceId as string));
    const rel: RelPath | undefined =
      node.path ? (typeof node.path === 'string' ? asRel(node.path) : node.path)
      : (Array.isArray(node.paths) && node.paths.length > 0
          ? (typeof node.paths[0] === 'string' ? asRel(node.paths[0]) : node.paths[0])
          : undefined);
    if (!ws || rel === undefined) { return undefined; }
    return { workspaceId: ws, relPath: rel };
  }

  // 2) URI from Explorer/Editor
  const uri = asUri(arg);
  if (uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) { return undefined; }
    const ws = stringToWsId(folder.uri.fsPath);
    const rel = relFromAbs(folder.uri.fsPath, uri.fsPath);
    if (rel === undefined) { return undefined; }
    return { workspaceId: ws, relPath: rel };
  }

  // 3) Active editor (optional)
  if (opts?.allowActiveEditor !== false) {
    const active = vscode.window.activeTextEditor?.document?.uri;
    if (active) {
      const folder = vscode.workspace.getWorkspaceFolder(active);
      if (!folder) { return undefined; }
      const ws = stringToWsId(folder.uri.fsPath);
      const rel = relFromAbs(folder.uri.fsPath, active.fsPath);
      if (rel === undefined) { return undefined; }
      return { workspaceId: ws, relPath: rel };
    }
  }

  return undefined;
}

/**
 * Resolve a target suitable for a DIFF view.
 * - If a Tree node includes `paths:[old,new]`, this prefers the **new** path.
 * - Otherwise behaves like resolveEntryTarget.
 */
export function resolveDiffTarget(arg?: unknown): ResolvedTarget | undefined {
  if (arg && typeof arg === 'object' && (arg as any).kind === 'entry') {
    const node = arg as EntryNodeArg;
    const ws: WorkspaceId = stringToWsId(typeof node.workspaceId === 'string' ? node.workspaceId : (node.workspaceId as string));
    const rel: RelPath | undefined =
      (Array.isArray(node.paths) && node.paths.length > 1)
        ? (typeof node.paths[1] === 'string' ? asRel(node.paths[1]) : node.paths[1])
        : (Array.isArray(node.paths) && node.paths.length === 1)
          ? (typeof node.paths[0] === 'string' ? asRel(node.paths[0]) : node.paths[0])
          : (node.path ? (typeof node.path === 'string' ? asRel(node.path) : node.path) : undefined);
    if (!ws || rel === undefined) { return undefined; }
    return { workspaceId: ws, relPath: rel };
  }
  return resolveEntryTarget(arg);
}

/**
 * Resolve a FOLDER target.
 * - If the selection is a file, returns its parent folder.
 * - Works with Tree nodes, Explorer/Editor URIs, or active editor.
 */
export function resolveFolderTarget(arg?: unknown): { workspaceId: WorkspaceId; folderPath: RelPath } | undefined {
  const base = resolveEntryTarget(arg);
  if (!base) { return undefined; }
  return { workspaceId: base.workspaceId, folderPath: base.relPath };
}