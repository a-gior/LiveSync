import * as vscode from 'vscode';

/**
 * Lightweight status bar notifications for quick operations
 * that don't warrant a full progress notification
 */
export class NotificationStatusBar {
  private item: vscode.StatusBarItem;
  private timeout?: NodeJS.Timeout;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.item.name = 'LiveSync Notification';
    this.item.command = 'livesync.showLogs';
  }

  /**
   * Show a temporary notification in the status bar
   */
  notify(message: string, icon: string = 'info', duration: number = 5000): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.item.text = `$(${icon}) ${message}`;
    this.item.show();

    this.timeout = setTimeout(() => {
      this.item.hide();
    }, duration);
  }

  /**
   * Show an error notification that stays longer
   */
  notifyError(message: string, duration: number = 5000): void {
    this.notify(message, 'error', duration);
  }

  /**
   * Show a success notification
   */
  notifySuccess(message: string, duration: number = 2000): void {
    this.notify(message, 'check', duration);
  }

  /**
   * Show upload notification
   */
  notifyUpload(filename: string): void {
    this.notify(`Uploaded ${filename}`, 'cloud-upload', 2000);
  }

  /**
   * Show download notification
   */
  notifyDownload(filename: string): void {
    this.notify(`Downloaded ${filename}`, 'cloud-download', 2000);
  }

  dispose(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.item.dispose();
  }
}