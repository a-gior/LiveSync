import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export async function tempPathFor(context: vscode.ExtensionContext, relPath: string): Promise<string> {
  const base = vscode.Uri.joinPath(context.globalStorageUri, '.livesync-tmp');
  await vscode.workspace.fs.createDirectory(base);
  const normRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const dir = vscode.Uri.joinPath(base, path.dirname(normRel));
  await vscode.workspace.fs.createDirectory(dir);
  const file = vscode.Uri.joinPath(base, normRel);
  return file.fsPath;
}

export async function ensureEmptyFile(fsPath: string): Promise<void> {
  await fs.mkdir(path.dirname(fsPath), { recursive: true });
  await fs.writeFile(fsPath, '', 'utf8');
}
