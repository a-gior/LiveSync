import * as vscode from "vscode";

export class LogManager {
  private static outputChannel: vscode.OutputChannel;

  static getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("LiveSync Logs");
    }
    return this.outputChannel;
  }

  static log(message: string) {
    const timestamp = this.getFormattedTimestamp();
    this.getOutputChannel().appendLine(`[${timestamp}] ${message}`);
  }

  static getFormattedTimestamp(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  static showLogs() {
    this.getOutputChannel().show();
  }
}
