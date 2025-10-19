import * as vscode from 'vscode';
import { ConfigErrorSuppressor } from '../../storage/ConfigErrorSuppressor';
import { stringToWsId } from '../path';


let _suppressor: ConfigErrorSuppressor | undefined;
export function initLoggingDeps(deps: { suppressor: ConfigErrorSuppressor }): void {
  _suppressor = deps.suppressor;
}
// --------------------------------------------------------------------------------------
// Flags (kept as-is for backward compatibility)
// --------------------------------------------------------------------------------------
export const LOG_FLAGS = {
  CONSOLE_ONLY: { console: true, logManager: false, vscode: false },
  LOG_MANAGER_ONLY: { console: false, logManager: true, vscode: false },
  VSCODE_ONLY: { console: false, logManager: false, vscode: true },
  CONSOLE_AND_LOG_MANAGER: { console: true, logManager: true, vscode: false },
  CONSOLE_AND_VSCODE: { console: true, logManager: false, vscode: true },
  LOG_MANAGER_AND_VSCODE: { console: false, logManager: true, vscode: true },
  ALL: { console: true, logManager: true, vscode: true },
};
export type LogFlags = (typeof LOG_FLAGS)[keyof typeof LOG_FLAGS];

// For error popups that include action buttons
export type LogErrorAction = { title: string; command: string; args?: any[] }[];

// --------------------------------------------------------------------------------------
// Serialization helper: cycle-safe, depth/size bounded, string output
// --------------------------------------------------------------------------------------
function safeStringify(value: unknown, maxDepth = 3, maxEntries = 50): string {
  const seen = new WeakSet<object>();
  const trunc = (s: string, lim = 2000) => (s.length > lim ? s.slice(0, lim) + '…' : s);

  function helper(v: unknown, depth: number): unknown {
    if (v === null) { return v; }
    const t = typeof v;
    if (t === 'string') { return trunc(v as string); }
    if (t === 'number' || t === 'boolean' || t === 'bigint') { return v; }
    if (t === 'function') { return '[Function]'; }
    if (t !== 'object') { return String(v); }
    if (depth <= 0) { return '[Object]'; }

    const obj = v as Record<string, unknown>;
    if (seen.has(obj)) { return '[Circular]'; }
    seen.add(obj);

    if (Array.isArray(obj)) {
      const out: unknown[] = [];
      for (let i = 0; i < Math.min(obj.length, maxEntries); i += 1) {
        out.push(helper(obj[i], depth - 1));
      }
      if (obj.length > maxEntries) { out.push(`…(+${obj.length - maxEntries} more)`); }
      return out;
    }

    // Map / Set
    if (obj instanceof Map) {
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const [k, v2] of obj.entries()) {
        if (count >= maxEntries) { out['…'] = '(+more)'; break; }
        out[String(k)] = helper(v2, depth - 1);
        count += 1;
      }
      return { '[Map]': out };
    }
    if (obj instanceof Set) {
      const out: unknown[] = [];
      let count = 0;
      for (const v2 of obj.values()) {
        if (count >= maxEntries) { out.push('(+more)'); break; }
        out.push(helper(v2, depth - 1));
        count += 1;
      }
      return { '[Set]': out };
    }

    // Plain object (and subclasses)
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(obj)) {
      if (count >= maxEntries) { result['…'] = '(+more keys)'; break; }
      result[key] = helper(obj[key], depth - 1);
      count += 1;
    }
    return result;
  }

  try {
    return JSON.stringify(helper(value, maxDepth));
  } catch {
    return '[Unserializable details]';
  }
}

function fmt(prefix: 'INFO' | 'ERROR' | 'WARN', message: string, details?: unknown): string {
  const base = `[${prefix}] ${message}`;
  if (details === undefined) { return base; }
  return `${base} ${safeStringify(details)}`;
}

// --------------------------------------------------------------------------------------
// Public logging helpers (kept API, improved internals)
// --------------------------------------------------------------------------------------
export function logErrorMessage(
  error: string,
  flags: LogFlags = LOG_FLAGS.CONSOLE_ONLY,
  details?: unknown,
  actions?: LogErrorAction
): void {
  const line = fmt('ERROR', error, details);

  if (flags.console) {
    console.error(`[LiveSync] ${line}`);
  }
  if (flags.logManager) {
    LogManager.log(line);
  }
  if (flags.vscode) {
    const titles = actions?.map((a) => a.title) ?? [];
    void vscode.window.showErrorMessage(error, ...titles).then((picked) => {
      if (!picked) { return; }
      const action = actions?.find((a) => a.title === picked);
      if (action?.command) {
        void vscode.commands.executeCommand(action.command, ...(action.args ?? []));
      }
    });
  }
}

export function logInfoMessage(
  message: string,
  flags: LogFlags = LOG_FLAGS.CONSOLE_ONLY,
  details?: unknown
): void {
  const line = fmt('INFO', message, details);

  if (flags.console) {
    console.info(`[LiveSync] ${line}`);
  }
  if (flags.logManager) {
    LogManager.log(line);
  }
  if (flags.vscode) {
    // Keep info toasts intentional; if you need default toasts, change the default flag at call sites.
    void vscode.window.showInformationMessage(message);
  }
}

export function logWarnMessage(
  message: string,
  flags: LogFlags = LOG_FLAGS.CONSOLE_ONLY,
  details?: unknown
): void {
  const line = fmt('WARN', message, details);

  if (flags.console) {
    console.warn(`[LiveSync] ${line}`);
  }
  if (flags.logManager) {
    LogManager.log(line);
  }
  if (flags.vscode) {
    void vscode.window.showWarningMessage(message);
  }
}

/**
 * Log an error that's expected/handled but should still be recorded.
 * Use this for non-fatal errors that won't show a popup but need tracking.
 */
export function logExpectedError(
  context: string,
  error: unknown,
  flags: LogFlags = LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
): void {
  const message = error instanceof Error ? error.message : String(error);
  const line = fmt('WARN', `[${context}] ${message}`, error);

  if (flags.console) {
    console.warn(`[LiveSync] ${line}`);
  }
  if (flags.logManager) {
    LogManager.log(line);
  }
  if (flags.vscode) {
    void vscode.window.showWarningMessage(`LiveSync: ${message}`);
  }
}

// --------------------------------------------------------------------------------------
// LogManager (OutputChannel holder) – minimal, stable surface
// --------------------------------------------------------------------------------------
export class LogManager {
  private static outputChannel: vscode.OutputChannel | undefined;

  static getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      // If you’re on a VS Code version that supports it, you can switch to:
      // this.outputChannel = vscode.window.createOutputChannel('LiveSync', { log: true });
      this.outputChannel = vscode.window.createOutputChannel('LiveSync Logs');
    }
    return this.outputChannel;
  }

  static log(message: string): void {
    const ts = this.timestamp();
    this.getOutputChannel().appendLine(`[${ts}] ${message}`);
  }

  static showLogs(): void {
    this.getOutputChannel().show();
  }

  private static timestamp(): string {
    const d = new Date();
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
}

// --------------------------------------------------------------------------------------
// Config error helper (kept as-is)
// --------------------------------------------------------------------------------------
export function logConfigError(
  flag: LogFlags = LOG_FLAGS.ALL,
  folder: vscode.WorkspaceFolder,
  errMessage: string = ''
): void {
  if (_suppressor?.isSuppressed(stringToWsId(folder.uri.fsPath))) {
    return; // user chose "Don't show again" for this workspace
  }

  const errorMessage = errMessage || 'The server is unreachable. Check your configuration.';
  const errorActions: LogErrorAction = [
    { title: 'Open Configuration', command: 'livesync.configuration' },
    { title: 'Retry Connection', command: 'livesync.testConnection' },
    { title: "Don't show again", command: 'livesync.dismissConfigError', args: [folder] },
  ];

  logErrorMessage(errorMessage, flag, undefined, errorActions);
}
