import * as vscode from "vscode";
import { basename } from "path";

type StatusBarItemKind = "messages" | "permanent" | "progress" | "errors";

export class StatusBarManager {
  private static statusBarItem: vscode.StatusBarItem;
  private static permanentItem: vscode.StatusBarItem;
  private static progressItem: vscode.StatusBarItem;
  private static errorItem: vscode.StatusBarItem;
  private static currentMessage: string;
  private static currentIcon: string;

  private static totalItems = 0;
  private static currentItem = 0;

  private static _errored = new Map<string, string>();

  static init(context: vscode.ExtensionContext) {
    // apply once on startup
    this.applySettings();

    // react to settings changes
    const sub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("livesync.statusBar.visibleItems")) {
        this.applySettings();
      }
    });

    context.subscriptions.push(
      sub,
      { dispose: () => this.disposeAll() }
    );
  }

  private static isEnabled(kind: StatusBarItemKind): boolean {
    const visible = vscode.workspace.getConfiguration("livesync").get<string[]>(
      "statusBar.visibleItems",
      ["messages", "permanent", "progress", "errors"]
    );
    return visible.includes(kind);
  }

  private static applySettings() {
    // If items already exist, show/hide them according to the setting.
    if (this.permanentItem) {
      this.isEnabled("permanent") ? this.permanentItem.show() : this.permanentItem.hide();
    }
    if (this.progressItem) {
      const canShow = this.isEnabled("progress") && this.totalItems > 0;
      canShow ? this.progressItem.show() : this.progressItem.hide();
    }
    if (this.errorItem) {
      const canShow = this.isEnabled("errors") && this._errored.size > 0;
      canShow ? this.errorItem.show() : this.errorItem.hide();
    }
    if (this.statusBarItem) {
      this.isEnabled("messages") ? this.statusBarItem.show() : this.statusBarItem.hide();
    }
  }

  private static disposeAll() {
    this.statusBarItem?.dispose();
    this.permanentItem?.dispose();
    this.progressItem?.dispose();
    this.errorItem?.dispose();
  }

  private static getStatusBarItem(): vscode.StatusBarItem {
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    }
    return this.statusBarItem;
  }

  private static getProgressItem(): vscode.StatusBarItem {
    if (!this.progressItem) {
      this.progressItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    }
    return this.progressItem;
  }

  static showMessage(message: string, tooltip?: string, command?: string, duration?: number, icon?: string, loading?: boolean) {
    if (!this.isEnabled("messages")) {return;} // hard block when disabled

    const statusBarItem = this.getStatusBarItem();

    let displayIcon = icon ? `$(${icon}) ` : "";
    if (loading) {displayIcon = `$(sync~spin) `;}

    let actualMessage = message;
    if (loading || icon) {actualMessage = message.replace(/^\$\([^)]+\)\s*/, "");}

    if (this.currentMessage !== actualMessage || this.currentIcon !== displayIcon) {
      statusBarItem.text = `${displayIcon}${actualMessage}`;
      statusBarItem.tooltip = tooltip || "";
      statusBarItem.command = command || "livesync.showLogs";
      statusBarItem.show();
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

  public static initProgress(total: number) {
    if (total <= 0) {return;}

    this.totalItems = Math.max(1, total);
    this.currentItem = 0;

    const item = this.getProgressItem();
    item.text = `$(pulse) 0%`;

    if (this.isEnabled("progress")) {item.show();}
    else {item.hide();}
  }

  public static step(increment: number = 1) {
    this.currentItem = Math.min(this.totalItems, this.currentItem + increment);
    const percent = Math.floor((this.currentItem / this.totalItems) * 100);

    const item = this.getProgressItem();
    item.text = `$(pulse) ${percent}%`;

    if (this.isEnabled("progress")) {
      if (this.currentItem >= this.totalItems) {
        setTimeout(() => this.endProgress(), 3000);
      } else {
        item.show();
      }
    } else {
      item.hide();
    }
  }

  public static endProgress() {
    const item = this.getProgressItem();
    item.hide();
    this.totalItems = 0;
    this.currentItem = 0;
  }

  static createPermanentIcon() {
    if (!this.permanentItem) {
      this.permanentItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      this.permanentItem.text = "$(gear) LiveSync";
      this.permanentItem.tooltip = "Open Settings";
      this.permanentItem.command = "livesync.configuration";
    }
    this.isEnabled("permanent") ? this.permanentItem.show() : this.permanentItem.hide();
  }

  static createErrorIcon() {
    if (!this.errorItem) {
      this.errorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
      this.errorItem.command = "livesync.showLogs";
    }
  }

  public static refreshErrorIcon(nbErrors: number = 0) {
    StatusBarManager.createErrorIcon();

    if (nbErrors === 0 || !this.isEnabled("errors")) {
      this.errorItem.hide();
      return;
    }

    this.errorItem.text = `$(error) ${nbErrors}`;

    const md = new vscode.MarkdownString(undefined, true);
    md.supportThemeIcons = true;
    md.isTrusted = false;

    md.appendMarkdown(`$(error) **LiveSync — Failed to Load Workspaces**\n\n`);
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
