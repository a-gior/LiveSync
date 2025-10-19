import * as vscode from 'vscode';
import { FileNodeSource } from '../utilities/FileNode';

export class Dialog {
  /**
   * Show a modal warning with a single “Delete” button.
   * @param scopeLabel e.g. “Local” or “Remote”
   * @param relativePath for the message
   * @param isDirectory is a directory
   * @returns true if the user clicked “Delete”
   */
  static async confirmDelete(
    scopeLabel: FileNodeSource,
    relativePath: string,
    isDirectory: boolean
  ): Promise<boolean> {
    const typeLabel = isDirectory ? 'folder' : 'file';
    const message = `Delete ${scopeLabel} ${typeLabel} “${relativePath}”?`;
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Delete'
    );
    return choice === 'Delete';
  }
}
