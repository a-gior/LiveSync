import * as vscode from 'vscode';
import { SyncStateManager } from '@app/SyncStateManager';
import { sha1OfFile } from '@infra/files/FileHash';
import { getWorkspaceFolderForUri, getWorkspaceId, getRelativePath } from '@infra/workspace/PathResolver';
import { FileMeta } from '@domain/types';

export class FileEventBridge {
  constructor(private readonly state: SyncStateManager) {}

  register(disposables: vscode.Disposable[]): void {
    disposables.push(
      vscode.workspace.onDidCreateFiles(async (event) => {
        for (const uri of event.files) {
          await this.handleCreate(uri);
        }
      }),
      vscode.workspace.onDidDeleteFiles(async (event) => {
        for (const uri of event.files) {
          await this.handleDelete(uri);
        }
      }),
      vscode.workspace.onDidRenameFiles(async (event) => {
        for (const pair of event.files) {
          await this.handleRename(pair.oldUri, pair.newUri);
        }
      }),
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        await this.handleModify(doc.uri);
      })
    );
  }

  private async handleCreate(uri: vscode.Uri): Promise<void> {
    const folder = getWorkspaceFolderForUri(uri);
    if (!folder) {
      return;
    }
    const workspaceId = getWorkspaceId(folder);
    const relativePath = getRelativePath(folder, uri);

    // Skip directories (createFiles typically only gives files, but be safe)
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      return;
    }

    const hash = await sha1OfFile(uri.fsPath);
    const meta: FileMeta = { type: 'file', hash };

    this.state.applyLocal({
      workspaceId,
      type: 'create',
      path: relativePath,
      meta
    });
  }

  private async handleDelete(uri: vscode.Uri): Promise<void> {
    const folder = getWorkspaceFolderForUri(uri);
    if (!folder) {
      return;
    }
    const workspaceId = getWorkspaceId(folder);
    const relativePath = getRelativePath(folder, uri);

    this.state.applyLocal({
      workspaceId,
      type: 'delete',
      path: relativePath
    });
  }

  private async handleRename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    const folder = getWorkspaceFolderForUri(newUri) ?? getWorkspaceFolderForUri(oldUri);
    if (!folder) {
      return;
    }
    const workspaceId = getWorkspaceId(folder);
    const oldRel = getRelativePath(folder, oldUri);
    const newRel = getRelativePath(folder, newUri);

    // If the new target is a file, compute hash; if folder, skip (folders inferred).
    let meta: FileMeta | undefined = undefined;
    const stat = await vscode.workspace.fs.stat(newUri);
    if ((stat.type & vscode.FileType.Directory) === 0) {
      const hash = await sha1OfFile(newUri.fsPath);
      meta = { type: 'file', hash };
    } else {
      meta = { type: 'folder' };
    }

    this.state.applyLocal({
      workspaceId,
      type: 'rename',
      path: oldRel,
      newPath: newRel,
      meta
    });
  }

  private async handleModify(uri: vscode.Uri): Promise<void> {
    const folder = getWorkspaceFolderForUri(uri);
    if (!folder) {
      return;
    }
    const workspaceId = getWorkspaceId(folder);
    const relativePath = getRelativePath(folder, uri);

    // Only hash files; if it’s a directory, ignore.
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      return;
    }

    const hash = await sha1OfFile(uri.fsPath);
    const meta: FileMeta = { type: 'file', hash };

    this.state.applyLocal({
      workspaceId,
      type: 'modify',
      path: relativePath,
      meta
    });
  }
}
