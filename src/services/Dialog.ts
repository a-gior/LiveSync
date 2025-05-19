import * as vscode from 'vscode';
import { FileNodeSource } from '../utilities/FileNode';

export class Dialog {
  /**
   * Show a modal warning with a single “Delete” button.
   * @param scopeLabel e.g. “Local” or “Remote”
   * @param relativePath for the message
   * @returns true if the user clicked “Delete”
   */
  static async confirmDelete(
    scopeLabel: FileNodeSource,
    relativePath: string
  ): Promise<boolean> {
    const message = `Delete ${scopeLabel} file ${relativePath}?`;
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      'Delete'
    );
    return choice === 'Delete';
  }
}
