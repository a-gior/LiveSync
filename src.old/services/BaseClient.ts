// src/services/BaseClient.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConnectConfig } from "ssh2";
import { ConnectionSettings } from "@shared/DTOs/config/ConnectionSettings";
// import { logInfoMessage } from "../managers/LogManager";

export abstract class BaseClient {
  protected isConnected = false;
  protected isConnecting = false;
  private connectPromise: Promise<void> | undefined;

  protected onReadyHandlers: Array<() => void> = [];
  protected onCloseHandlers: Array<() => void> = [];
  protected onErrorHandlers: Array<(e: any) => void> = [];

  onReady(h: () => void) { this.onReadyHandlers.push(h); }
  onClose(h: () => void) { this.onCloseHandlers.push(h); }
  onError(h: (e: any) => void) { this.onErrorHandlers.push(h); }

  /**
   * Ensures a single in-flight connect and idempotent reuse.
   * Subclasses must set isConnected=true when ready, and false on close/error.
   */
  protected async guardedConnect(fn: () => Promise<void>): Promise<void> {
    if (this.isConnected) {return;}
    if (this.connectPromise) {return this.connectPromise;}

    this.isConnecting = true;
    const p = (async () => {
      try {
        await fn();
      } catch (err) {
        this.isConnected = false;
        throw err;
      } finally {
        this.isConnecting = false;
        this.connectPromise = undefined;
      }
    })();

    this.connectPromise = p;
    return p;
  }

  abstract connect(config: ConnectionSettings): Promise<void>;
  abstract disconnect(): Promise<void>;

  /** ssh2 options (handshake timeout + keepalives + debug) */
  protected getSSH2Options(
    cfg: ConnectionSettings,
    handshakeTimeoutMs = 3000
  ): ConnectConfig {
    if (!cfg.password && !cfg.privateKeyPath) {
      throw new Error("Either a password or a privateKeyPath must be provided");
    }

    let privateKey: Buffer | undefined;
    if (cfg.privateKeyPath) {
      privateKey = Buffer.from(this.getPrivateKeyContent(cfg.privateKeyPath), "utf8");
    }

    return {
      host: cfg.hostname,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password || undefined,
      privateKey,
      passphrase: cfg.passphrase,
      readyTimeout: handshakeTimeoutMs,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      // debug: (msg: string) => logInfoMessage(`[ssh2] ${msg}`)
    };
  }

  /** Extra retry options understood by ssh2-sftp-client */
  protected getSftpRetryOptions() {
    return { retries: 0, retry_minTimeout: 200, retry_factor: 1 };
  }

  private getPrivateKeyContent(pKeyPath: string): string {
    if (pKeyPath.startsWith("~")) {
      pKeyPath = path.join(os.homedir(), pKeyPath.slice(1));
    }
    pKeyPath = path.resolve(pKeyPath);
    if (!fs.existsSync(pKeyPath)) {
      throw new Error(`Private key file not found at ${pKeyPath}`);
    }
    return fs.readFileSync(pKeyPath, "utf8");
  }
}
