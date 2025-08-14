import * as vscode from "vscode";
import { basename } from "path";

export class StatusBarManager {
  private static statusBarItem: vscode.StatusBarItem;
  private static permanentItem: vscode.StatusBarItem;
  private static progressItem: vscode.StatusBarItem;
  private static errorItem: vscode.StatusBarItem;
  private static currentMessage: string;
  private static currentIcon: string;

  private static totalItems: number = 0;
  private static currentItem: number = 0;
  
  private static _errored = new Map<string, string>();

  private static getStatusBarItem(): vscode.StatusBarItem {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    }
    return this.statusBarItem;
  }

  private static getProgressItem(): vscode.StatusBarItem {
    if (!this.progressItem) {
      this.progressItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100); // Slightly lower priority
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

  /**
   * Initialize the progress bar with the total number of items.
   * @param total Total number of items to process.
   */
  public static initProgress(total: number) {
    if (total <= 0) {
      // nothing to process, so just hide (or skip showing altogether)
      return;
    }

    this.totalItems = Math.max(1, total);
    this.currentItem = 0;

    const item = this.getProgressItem();
    item.text = `$(pulse) 0%`;
    item.show();
  }

  /**
   * Advance the progress by one item.
   * Optionally, you can pass a count > 1.
   * @param increment Number of items processed (default is 1).
   */
  public static step(increment: number = 1) {
    this.currentItem = Math.min(this.totalItems, this.currentItem + increment);
    const percent = Math.floor((this.currentItem / this.totalItems) * 100);

    const item = this.getProgressItem();
    item.text = `$(pulse) ${percent}%`;

    // Auto-hide when complete
    if (this.currentItem >= this.totalItems) {
      setTimeout(() => this.endProgress(), 3000);
    }
  }

  /**
   * Immediately finish and hide the progress bar.
   */
  public static endProgress() {
    const item = this.getProgressItem();
    item.hide();

    // Reset counters
    this.totalItems = 0;
    this.currentItem = 0;
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

  static createErrorIcon() {
    if (!this.errorItem) {
      this.errorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
      this.errorItem.command = 'livesync.showLogs';   // or open Problems
      this.errorItem.show();
    }
  }

  public static refreshErrorIcon(nbErrors: number = 0) {
    StatusBarManager.createErrorIcon();

    if (nbErrors === 0) {
      this.errorItem.hide();
      return;
    }

    // text = icon + count
    this.errorItem.text = `$(error) ${nbErrors}`;

    // Build a Markdown tooltip
    const md = new vscode.MarkdownString(undefined, true);
    md.supportThemeIcons = true; // allow $(folder) icon
    md.isTrusted = false; // no links needed here

    md.appendMarkdown(`$(error) **LiveSync — Failed to Load Workspaces**\n\n`);

    // one line per workspace
    Array.from(this._errored.entries()).forEach(([id, msg]) => {
      const name = basename(vscode.Uri.parse(id).fsPath);
      md.appendMarkdown(`$(folder) **${name}**: ${msg}  \n`);
    });

    this.errorItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    this.errorItem.color = new vscode.ThemeColor("statusBarItem.errorForeground");
    this.errorItem.tooltip = md;
    this.errorItem.show();
  }
  
  public static markErrored(id: string, errorMessage: string) {
      this._errored.set(id, errorMessage);
      StatusBarManager.refreshErrorIcon(this._errored.size);
  }

  public static clearErrored(id: string) {
      this._errored.delete(id);
      StatusBarManager.refreshErrorIcon(this._errored.size);
  }

  public static getError(id: string) {
    return this._errored.get(id) || "";
  }
}
