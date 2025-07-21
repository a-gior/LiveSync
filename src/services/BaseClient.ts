import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logInfoMessage } from "../managers/LogManager";
import { ConnectConfig } from "ssh2";
import { ConnectionSettings } from "@shared/DTOs/config/ConnectionSettings";

export abstract class BaseClient {
  protected isConnected = false;
  protected isConnecting = false;
  private connectPromise: Promise<void> | null = null;

  /** 
   * Prevent concurrent connect() calls by sharing a single in-flight promise 
   */
  protected async guardedConnect(
    fn: () => Promise<void>
  ): Promise<void> {
    if (this.isConnected) {return;}
    if (this.connectPromise) {return this.connectPromise;}

    this.isConnecting = true;
    this.connectPromise = fn()
      .then(() => {
        this.isConnected = true;
      })
      .catch(err => {
        this.isConnected = false;
        throw err;
      })
      .finally(() => {
        this.isConnecting = false;
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  abstract connect(config: ConnectionSettings): Promise<void>;
  abstract disconnect(): Promise<void>;

  public get connected(): boolean {
    return this.isConnected;
  }

  public get connecting(): boolean {
    return this.isConnecting;
  }

  /** 
   * Wait up to `timeoutMs`, polling until either `isConnected` or timeout. 
   */
  async waitForConnection(timeoutMs = 5000, pollInterval = 1000): Promise<void> {
    const start = Date.now();
    while (!this.isConnected && this.isConnecting && Date.now() - start < timeoutMs) {
      logInfoMessage(
        `Waiting for connection: ${Date.now() - start}ms elapsed`
      );
      await new Promise(r => setTimeout(r, pollInterval));
    }
    if (!this.isConnected) {
      throw new Error('Timeout waiting for connection');
    }
  }

  protected getConnectionOptions(
    cfg: ConnectionSettings,
    handshakeTimeout = 1000
  ): ConnectConfig {
    if (!cfg.password && !cfg.privateKeyPath) {
      throw new Error('Either a password or a privateKeyPath must be provided');
    }

    let privateKey: Buffer | undefined;
    if (cfg.privateKeyPath) {
      privateKey = Buffer.from(
        this.getPrivateKeyContent(cfg.privateKeyPath),
        'utf8'
      );
    }

    return {
      host: cfg.hostname,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password || undefined,
      privateKey,
      passphrase: cfg.passphrase,
      readyTimeout: handshakeTimeout,
    };
  }

  private getPrivateKeyContent(pKeyPath: string): string {
    // Expand '~'
    if (pKeyPath.startsWith('~')) {
      pKeyPath = path.join(os.homedir(), pKeyPath.slice(1));
    }
    // Resolve relative and normalize
    pKeyPath = path.resolve(pKeyPath);
    if (!fs.existsSync(pKeyPath)) {
      throw new Error(`Private key file not found at ${pKeyPath}`);
    }
    return fs.readFileSync(pKeyPath, 'utf8');
  }
}