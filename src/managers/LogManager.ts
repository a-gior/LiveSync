import * as vscode from "vscode";
import { SilentError } from "../utilities/errors";

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
export type LogErrorAction = { title: string; command: string }[];

function deepClone<T>(obj: T): T {
  // Handle null or undefined
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  // Handle Date
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }

  // Handle Array
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as any;
  }

  // Handle Map
  if (obj instanceof Map) {
    const clonedMap = new Map();
    obj.forEach((value, key) => {
      clonedMap.set(key, deepClone(value));
    });
    return clonedMap as any;
  }

  // Handle Set
  if (obj instanceof Set) {
    const clonedSet = new Set();
    obj.forEach((value) => {
      clonedSet.add(deepClone(value));
    });
    return clonedSet as any;
  }

  // Handle Object
  if (obj instanceof Object) {
    const clonedObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj as T;
  }

  // Handle any other types (e.g., functions, etc.)
  return obj;
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
        vscode.commands.executeCommand(action.command);
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

export function logConfigError(ctx: vscode.ExtensionContext, flag: LogFlags = LOG_FLAGS.ALL, shouldThrow: boolean = false) {
  const errorMessage = "The server is unreachable. Check your configuration.";
  const isSuppressed = ctx.globalState.get<boolean>(
    'suppressConfigError',
    false
  );

  if (isSuppressed ) {
    // User clicked “Don’t show again” previously → skip showing this error
    return;
  }


  // Default actions for this error
  const errorActions: LogErrorAction = [
    { title: "Open Configuration", command: "livesync.configuration" },
    { title: "Retry Connection", command: "livesync.testConnection" },
    {  title: `Don't show again`, command: 'livesync.dismissConfigError'}
  ];

  logErrorMessage(errorMessage, flag, undefined, errorActions);
  
  if (shouldThrow) {
    throw new SilentError(errorMessage);
  }
}
