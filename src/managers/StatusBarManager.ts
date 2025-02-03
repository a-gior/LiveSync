import * as vscode from "vscode";

export class StatusBarManager {
  private static statusBarItem: vscode.StatusBarItem;
  private static permanentItem: vscode.StatusBarItem;
  private static progressItem: vscode.StatusBarItem;
  private static currentMessage: string;
  private static currentIcon: string;

  private static getStatusBarItem(): vscode.StatusBarItem {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    }
    return this.statusBarItem;
  }

  private static getProgressItem(): vscode.StatusBarItem {
    if (!this.progressItem) {
      this.progressItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99); // Slightly lower priority
    }
    return this.progressItem;
  }

  static showMessage(message: string, tooltip?: string, command?: string, duration?: number, icon?: string, loading?: boolean) {
    const statusBarItem = this.getStatusBarItem();

    let displayIcon = icon ? `$(${icon}) ` : "";
    if (loading) {
      displayIcon = `$(sync~spin) `;
    }

    // Extract the actual message without the icon
    let actualMessage = message;
    if (loading || icon) {
      actualMessage = message.replace(/^\$\([^\)]+\)\s*/, "");
    }

    // Check if the actual message is different
    if (this.currentMessage !== actualMessage || this.currentIcon !== displayIcon) {
      statusBarItem.text = `${displayIcon}${actualMessage}`;
      statusBarItem.tooltip = tooltip || "";
      statusBarItem.command = command || "livesync.showLogs";
      statusBarItem.show();

      // LogManager.log(message); // Log the message
      this.currentMessage = actualMessage;
      this.currentIcon = displayIcon;
    }

    if (duration) {
      setTimeout(() => {
        if (this.currentMessage === actualMessage) {
          statusBarItem.hide();
          this.currentMessage = "";
          this.currentIcon = "";
        }
      }, duration);
    }
  }

  static hideMessage() {
    if (this.statusBarItem) {
      this.statusBarItem.hide();
      this.currentMessage = "";
      this.currentIcon = "";
    }
  }

  static showProgress(progress: number) {
    const progressItem = this.getProgressItem();

    // Ensure progress is between 0-100
    const clampedProgress = Math.min(100, Math.max(0, progress));

    progressItem.text = `$(pulse) ${clampedProgress}%`;
    progressItem.show();

    // Hide when reaching 100%
    if (clampedProgress >= 100) {
      setTimeout(() => progressItem.hide(), 2000);
    }
  }

  static createPermanentIcon() {
    if (!this.permanentItem) {
      this.permanentItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      this.permanentItem.text = "$(gear) LiveSync";
      this.permanentItem.tooltip = "Open Settings";
      this.permanentItem.command = "livesync.configuration";
      this.permanentItem.show();
    }
  }
}
