// src/services/ConnectionService.ts
import * as net from "net";
import { SFTPClient } from "./SFTPClient";
import { SSHClient } from "./SSHClient";
import { StatusBarManager } from "../managers/StatusBarManager";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "../managers/LogManager";
import { ConnectionSettings } from "../DTOs/config/ConnectionSettings";
import { WorkspaceConfig } from "./WorkspaceConfig";
import { handleConfigError, WorkspaceConfigError } from "../errors/WorkspaceConfigError";

export class ConnectionService {
  private sshClient = new SSHClient();
  private sftpClient = new SFTPClient();
  private sshActive = 0;
  private sftpActive = 0;
  private sshDisconnectTimer: NodeJS.Timeout | null = null;
  private sftpDisconnectTimer: NodeJS.Timeout | null = null;
  private readonly maxRetries = 3;
  private readonly backoffBaseMs = 500;

  private _linkedWorkspaceConfig: WorkspaceConfig | null = null;

  constructor(private readonly cfg: ConnectionSettings) {
    // Wire SSH lifecycle → UI
    this.sshClient.onReady(() => this.onConnUp("ssh"));
    this.sshClient.onClose(() => this.onConnDown("ssh"));
    this.sshClient.onError(e => this.onConnError("ssh", e));

    // Wire SFTP lifecycle → UI
    this.sftpClient.onReady(() => this.onConnUp("sftp"));
    this.sftpClient.onClose(() => this.onConnDown("sftp"));
    this.sftpClient.onError(e => this.onConnError("sftp", e));
  }

  public link(wc: WorkspaceConfig) {
    this._linkedWorkspaceConfig = wc;
  }

  public get linkedWorkspaceConfig(): WorkspaceConfig {
    if (!this._linkedWorkspaceConfig) {
      throw new Error("No workspace config linked to this connection service");
    }
    return this._linkedWorkspaceConfig;
  }

  public async ensureReachable(): Promise<void> {
    const ok = await ConnectionService.isReachable(
      this.cfg.hostname,
      this.cfg.port
    );
    if (!ok) {
      throw new Error(`Host unreachable: ${this.cfg.hostname}:${this.cfg.port}`);
    }
  }

  public async withSSH<T>(op: (c: SSHClient) => Promise<T>, label?: string): Promise<T> {
    this.sshActive++;
    if (label) {StatusBarManager.showMessage(label, "", "", 0, "sync~spin", true);}
    try {
      await this.sshClient.connect(this.cfg);
      const result = await this.retry(() => op(this.sshClient));
      if (label) {StatusBarManager.showMessage(label, "", "", 3000, "check");}
      return result;
    } catch (err) {
      if (label) {StatusBarManager.showMessage(label, "", "", 3000, "error");}
      throw err;
    } finally {
      this.sshActive--;
      this.scheduleDisconnect("ssh");
    }
  }

  public async withSFTP<T>(op: (c: SFTPClient) => Promise<T>, label?: string): Promise<T> {
    this.sftpActive++;
    if (label) {StatusBarManager.showMessage(label, "", "", 0, "sync~spin", true);}
    try {
      await this.sftpClient.connect(this.cfg);
      const result = await this.retry(() => op(this.sftpClient));
      if (label) {StatusBarManager.showMessage(label, "", "", 3000, "check");}
      return result;
    } catch (err) {
      if (label) {StatusBarManager.showMessage(label, "", "", 3000, "error");}
      throw err;
    } finally {
      this.sftpActive--;
      this.scheduleDisconnect("sftp");
    }
  }

  public async dispose(): Promise<void> {
    if (this.sshDisconnectTimer) {clearTimeout(this.sshDisconnectTimer);}
    if (this.sftpDisconnectTimer) {clearTimeout(this.sftpDisconnectTimer);}
    await this.sshClient.disconnect();
    await this.sftpClient.disconnect();
  }

  /** Optional preflight if you want a quick reachability check elsewhere */
  public static isReachable(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const sock = new net.Socket();
      sock.setTimeout(2000);
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("timeout", () => { sock.destroy(); resolve(false); });
      sock.once("error", () => { sock.destroy(); resolve(false); });
      sock.connect(port, host);
    });
  }

  private scheduleDisconnect(type: "ssh" | "sftp") {
    const timerRef = type === "ssh" ? "sshDisconnectTimer" : "sftpDisconnectTimer";
    const disconnectFn = type === "ssh"
      ? this.sshClient.disconnect.bind(this.sshClient)
      : this.sftpClient.disconnect.bind(this.sftpClient);

    if (this[timerRef]) {clearTimeout(this[timerRef]!);}
    this[timerRef] = setTimeout(async () => {
      const activeNow = type === "ssh" ? this.sshActive : this.sftpActive; // read live count
      if (activeNow === 0) {await disconnectFn();}
    }, 5000);
  }

  private async retry<T>(fn: () => Promise<T>, retries = this.maxRetries): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (retries > 0 && this.isRetryable(err)) {
        const backoff = this.backoffBaseMs * (this.maxRetries - retries + 1);
        logInfoMessage(`Retrying in ${backoff}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, backoff));
        return this.retry(fn, retries - 1);
      }
      logErrorMessage(err.message, LOG_FLAGS.VSCODE_ONLY);
      throw err;
    }
  }

  private isRetryable(err: any): boolean {
    const code = err?.code || "";
    const msg = String(err?.message || "");
    return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "ERR_GENERIC_CLIENT"]
      .includes(code) || /Instance unusable|timed out/i.test(msg);
  }

  private onConnUp(kind: "ssh" | "sftp") {
    StatusBarManager.showMessage(`${kind.toUpperCase()} connected`, "", "", 1500, "check");
  }

  private onConnDown(kind: "ssh" | "sftp") {
    try {
      logInfoMessage(`Connection ${kind} closed.`);
    } catch {
      // not linked yet; ignore
    }
  }

  private onConnError(kind: "ssh" | "sftp", e: any) {
    try {
      const error = new WorkspaceConfigError(this.linkedWorkspaceConfig.folder, e?.message ?? "Connection error");
      handleConfigError(error, this.linkedWorkspaceConfig.folder, true);
    } catch {
      // not linked yet; ignore
    }
  }
}
