import * as vscode from "vscode";

export class StatusBarManager {
  private static statusBarItem: vscode.StatusBarItem;
  private static permanentItem: vscode.StatusBarItem;

  private static getStatusBarItem(): vscode.StatusBarItem {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100,
      );
    }
    return this.statusBarItem;
  }

  static showMessage(
    message: string,
    tooltip?: string,
    command?: string,
    duration?: number,
    icon?: string,
    loading?: boolean,
  ) {
    const statusBarItem = this.getStatusBarItem();

    let displayMessage = message;
    if (icon) {
      displayMessage = `$(${icon}) ${message}`;
    }
    if (loading) {
      displayMessage = `$(sync~spin) ${message}`;
    }

    statusBarItem.text = displayMessage;
    statusBarItem.tooltip = tooltip || "";
    if (command) {
      statusBarItem.command = command;
    }
    statusBarItem.show();

    if (duration) {
      setTimeout(() => {
        statusBarItem.hide();
      }, duration);
    }
  }

  static hideMessage() {
    if (this.statusBarItem) {
      this.statusBarItem.hide();
    }
  }

  static createPermanentIcon() {
    if (!this.permanentItem) {
      this.permanentItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100,
      );
      this.permanentItem.text = "$(gear) LiveSync";
      this.permanentItem.tooltip = "Open Settings";
      this.permanentItem.command = "livesync.configuration";
      this.permanentItem.show();
    }
  }
}
