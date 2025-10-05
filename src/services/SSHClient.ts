// src/services/SSHClient.ts
import { Client } from "ssh2";
import { BaseClient } from "./BaseClient";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "../managers/LogManager";

export class SSHClient extends BaseClient {
  private client: Client | null = null;

  /** Create a fresh ssh2 Client and drop old listeners safely */
  private newClient(): Client {
    if (this.client) {
      try { this.client.removeAllListeners(); } catch {}
      try { this.client.end(); } catch {}
    }
    this.client = new Client();
    return this.client;
  }

  public async connect(cfg: ConfigurationMessage["configuration"]): Promise<void> {
    await this.guardedConnect(async () => {
      const opts: any = this.getSSH2Options(cfg); // base ssh2 opts
      const endpoint = `${cfg.hostname}:${cfg.port}`;

      const c = this.newClient();

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

        const onReady = () => settle(() => {
          this.isConnected = true;
          this.onReadyHandlers.forEach(h => h());
          logInfoMessage("SSH: connection ready");
          cleanup();
          resolve();
        });

        const onError = (err: any) => settle(() => {
          this.isConnected = false;
          const newErr = new Error(`${err.message} (${endpoint})`);
          this.onErrorHandlers.forEach(h => h(newErr));
          logErrorMessage(`SSH: connection error: ${newErr?.message}`, LOG_FLAGS.CONSOLE_ONLY, newErr);
          cleanup();
          reject(newErr);
        });

        const onClose = (hadErr?: boolean) => {
          this.isConnected = false;
          this.onCloseHandlers.forEach(h => h());
          logInfoMessage(`SSH: connection closed (hadErr=${!!hadErr})`);
          if (!settled) {onError(new Error("SSH closed during handshake"));}
        };

        const cleanup = () => {
          c.removeListener("ready", onReady);
          c.removeListener("error", onError);
          c.removeListener("close", onClose);
          clearTimeout(safety);
        };

        const safety = setTimeout(() => onError(new Error("SSH connect safety timeout")),
                                  (opts.readyTimeout ?? 6000) + 2000);

        c.on("ready", onReady);
        c.on("error", onError);
        c.on("close", onClose);

        logInfoMessage(`SSH: connecting to ${opts.host}:${opts.port}`, LOG_FLAGS.CONSOLE_ONLY);
        c.connect(opts);
      });
    });
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected && !this.client) {return;}
    logInfoMessage("SSH: disconnecting");
    try { this.client?.end(); } finally {
      this.isConnected = false;
      this.client = null;
    }
  }

  public async executeCommand(
    command: string,
    dataCb?: (line: string) => void
  ): Promise<string> {
    let output = "";
    return new Promise<string>((resolve, reject) => {
      const cli = this.client;
      if (!cli) {return reject(new Error("SSH not connected"));}

      cli.exec(command, (err, stream) => {
        if (err) {return reject(err);}

        let exitCode: number | null = null;
        let exitSignal: string | null = null;
        let buffer = "";

        stream.on("exit", (code: number | null, signal: string | null) => {
          exitCode = code;
          exitSignal = signal;
        });

        const flush = (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";
          for (const line of parts) {dataCb?.(line + "\n");}
        };

        stream
          .on("data", (b: Buffer) => { flush(b.toString()); output += b; })
          .stderr.on("data", (b: Buffer) => { flush(b.toString()); output += b; });

        stream.on("close", () => {
          if (buffer && dataCb) {dataCb(buffer);}

          const code = exitCode !== null ? exitCode : -1;
          const signal = exitSignal !== null ? exitSignal : "none";

          if (![0, 1].includes(code)) {
            return reject(new Error(`Command "${command}" failed: code=${code}, signal=${signal}`));
          }
          if (code === 1) {
            logErrorMessage(
              `Command "${command}" exited with code 1 (permissions?)`,
              LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
            );
          }
          resolve(output);
        });
      });
    });
  }

  public async mkdirs(dirs: string[]): Promise<void> {
    if (dirs.length === 0) {return;}
    const cmd = `mkdir -p ${dirs.map(d => `'${d}'`).join(" ")}`;
    await this.executeCommand(cmd);
  }

  public async move(oldPath: string, newPath: string): Promise<void> {
    await this.executeCommand(`mv "${oldPath}" "${newPath}"`);
  }

  public async count(remoteDir: string): Promise<number> {
    const raw = await this.executeCommand(`find "${remoteDir}" | wc -l`);
    const lastLine = raw.trim().split("\n").pop() || "0";
    return parseInt(lastLine, 10) || 0;
    }
}
