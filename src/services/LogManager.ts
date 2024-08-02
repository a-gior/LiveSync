import * as vscode from "vscode";

// Define constants for the logging flags
export const LOG_FLAGS = {
  CONSOLE_ONLY: { console: true, logManager: false, vscode: false },
  LOG_MANAGER_ONLY: { console: false, logManager: true, vscode: false },
  VSCODE_ONLY: { console: false, logManager: false, vscode: true },
  CONSOLE_AND_LOG_MANAGER: { console: true, logManager: true, vscode: false },
  CONSOLE_AND_VSCODE: { console: true, logManager: false, vscode: true },
  LOG_MANAGER_AND_VSCODE: { console: false, logManager: true, vscode: true },
  ALL: { console: true, logManager: true, vscode: true },
};
type LogFlags = (typeof LOG_FLAGS)[keyof typeof LOG_FLAGS];

/**
 * Logs an error message to the console, LogManager, and/or shows a VS Code error message.
 * @param error - The error message to log.
 * @param flags - A combination of LOG_FLAGS to specify where to log the message.
 * @param details - Additional details to log only to the console.
 */
export function logErrorMessage(
  error: string,
  flags: LogFlags = LOG_FLAGS.ALL,
  details?: any,
) {
  if (flags.console) {
    if (details !== undefined) {
      console.error(`Error: ${error}`, details);
    } else {
      console.error(`Error: ${error}`);
    }
  }
  if (flags.logManager) {
    LogManager.log(`Error: ${error}`);
  }
  if (flags.vscode) {
    vscode.window.showErrorMessage(`Error: ${error}`);
  }
}

/**
 * Logs an informational message to the console, LogManager, and/or shows a VS Code info message.
 * @param message - The informational message to log.
 * @param flags - A combination of LOG_FLAGS to specify where to log the message.
 * @param details - Additional details to log only to the console.
 */
export function logInfoMessage(
  message: string,
  flags: LogFlags = LOG_FLAGS.ALL,
  details?: any,
) {
  if (flags.console) {
    if (details !== undefined) {
      console.info(`[INFO] ${message}`, details);
    } else {
      console.info(`[INFO] ${message}`);
    }
  }
  if (flags.logManager) {
    LogManager.log(`[INFO] ${message}`);
  }
  if (flags.vscode) {
    vscode.window.showInformationMessage(`Info: ${message}`);
  }
}

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
