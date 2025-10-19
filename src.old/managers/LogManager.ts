import * as vscode from "vscode";
import { isConfigErrorSuppressed } from "../storage/ConfigErrorSuppressor";

// Define constants for the logging flags
export const LOG_FLAGS = {
  CONSOLE_ONLY: { console: true, logManager: false, vscode: false },
  LOG_MANAGER_ONLY: { console: false, logManager: true, vscode: false },
  VSCODE_ONLY: { console: false, logManager: false, vscode: true },
  CONSOLE_AND_LOG_MANAGER: { console: true, logManager: true, vscode: false },
  CONSOLE_AND_VSCODE: { console: true, logManager: false, vscode: true },
  LOG_MANAGER_AND_VSCODE: { console: false, logManager: true, vscode: true },
  ALL: { console: true, logManager: true, vscode: true }
};
type LogFlags = (typeof LOG_FLAGS)[keyof typeof LOG_FLAGS];

// Define the LogErrorAction type
export type LogErrorAction = { title: string; command: string; args?: any[] }[];

function deepClone<T>(obj: T, seen = new WeakMap<any, any>()): T {
  // Primitives & functions just pass through
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  // If we’ve already cloned this exact object, return the existing clone
  if (seen.has(obj)) {
    return seen.get(obj);
  }

  // Handle Date
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }

  // Handle Array
  if (Array.isArray(obj)) {
    const arr: any[] = [];
    seen.set(obj, arr);
    for (const item of obj) {
      arr.push(deepClone(item, seen));
    }
    return arr as any;
  }

  // Handle Map
  if (obj instanceof Map) {
    const clonedMap = new Map();
    seen.set(obj, clonedMap);
    for (const [key, value] of obj.entries()) {
      clonedMap.set(key, deepClone(value, seen));
    }
    return clonedMap as any;
  }

  // Handle Set
  if (obj instanceof Set) {
    const clonedSet = new Set();
    seen.set(obj, clonedSet);
    for (const value of obj.values()) {
      clonedSet.add(deepClone(value, seen));
    }
    return clonedSet as any;
  }

  // Handle plain Object (and subclassed plain objects)
  const proto = Object.getPrototypeOf(obj);
  const clonedObj = Object.create(proto);
  seen.set(obj, clonedObj);
  for (const key of Object.keys(obj as any)) {
    clonedObj[key] = deepClone((obj as any)[key], seen);
  }
  return clonedObj;
}

export function logErrorMessage(error: string, flags: LogFlags = LOG_FLAGS.CONSOLE_ONLY, details?: any, actions?: LogErrorAction) {
  // Log to console
  if (flags.console) {
    if (details !== undefined) {
      const serializedDetails = deepClone(details); // Use custom serialization for complex objects
      console.error(`[ERROR] ${error}`, serializedDetails);
    } else {
      console.error(`[ERROR]: ${error}`);
    }
  }

  // Log to LogManager
  if (flags.logManager) {
    LogManager.log(`[ERROR]: ${error}`);
  }

  // Show error message in VS Code with optional actions
  if (flags.vscode) {
    const actionTitles = actions?.map((action) => action.title) || [];
    vscode.window.showErrorMessage(`${error}`, ...actionTitles).then((selectedAction) => {
      if (!selectedAction) {
        return;
      }

      // Execute the command associated with the selected action
      const action = actions?.find((action) => action.title === selectedAction);
      if (action && action.command) {
        vscode.commands.executeCommand(action.command, ...(action.args ?? []));
      }
    });
  }
}

export function logInfoMessage(message: string, flags: LogFlags = LOG_FLAGS.CONSOLE_ONLY, details?: any) {
  if (flags.console) {
    if (details !== undefined) {
      const serializedDetails = deepClone(details); // Use custom serialization for complex objects
      console.info(`[INFO] ${message}`, serializedDetails);
    } else {
      console.info(`[INFO] ${message}`);
    }
  }
  if (flags.logManager) {
    LogManager.log(`[INFO] ${message}`);
  }
  if (flags.vscode) {
    vscode.window.showInformationMessage(`${message}`);
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

export function logConfigError(flag: LogFlags = LOG_FLAGS.ALL, folder: vscode.WorkspaceFolder, errMessage: string = "") {
  if (isConfigErrorSuppressed(folder)) {
    return; // user chose "Don't show again" for this workspace
  }
  
  const errorMessage = errMessage || "The server is unreachable. Check your configuration.";
  
  // Default actions for this error
  const errorActions: LogErrorAction = [
    { title: "Open Configuration", command: "livesync.configuration" },
    { title: "Retry Connection", command: "livesync.testConnection" },
    {  title: `Don't show again`, command: 'livesync.dismissConfigError', args: [folder]}
  ];

  logErrorMessage(errorMessage, flag, undefined, errorActions);
}
