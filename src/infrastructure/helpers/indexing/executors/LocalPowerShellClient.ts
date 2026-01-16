/**
 * Persistent PowerShell process for Windows local scanning
 * 
 * Keeps a single PS process alive to avoid ~500ms startup overhead per command.
 * Supports both buffered and streaming output.
 */

import { spawn, ChildProcess } from 'child_process';

export class LocalPowerShellClient {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private lineQueue: string[] = [];
  private resolvers: Array<() => void> = [];

  /**
   * Execute a PowerShell script and stream lines as they arrive
   */
  async *execStreaming(
    script: string,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, undefined> {
    await this.ensureProcess();
    
    const marker = `__END_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    this.lineQueue = [];
    this.buffer = '';
    let done = false;

    const processData = (chunk: Buffer) => {
      this.buffer += chunk.toString();
      
      // Split into lines
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.includes(marker)) {
          done = true;
          // Notify any waiting consumer
          this.resolvers.forEach(r => r());
          this.resolvers = [];
          return;
        }
        // Skip READY prompt and empty lines
        if (line.trim() && !line.includes('READY')) {
          this.lineQueue.push(line);
          // Notify waiting consumer
          if (this.resolvers.length > 0) {
            const resolver = this.resolvers.shift();
            resolver?.();
          }
        }
      }
    };

    this.process!.stdout!.on('data', processData);

    try {
      // Send script with end marker
      this.process!.stdin!.write(`${script}\nWrite-Host '${marker}'\n`);

      while (!done || this.lineQueue.length > 0) {
        if (signal?.aborted) {break;}
        
        if (this.lineQueue.length > 0) {
          yield this.lineQueue.shift()!;
        } else if (!done) {
          // Wait for more data
          await new Promise<void>(resolve => {
            this.resolvers.push(resolve);
          });
        }
      }
    } finally {
      this.process!.stdout!.off('data', processData);
    }
  }

  /**
   * Execute a PowerShell script and return full output (buffered)
   */
  async exec(script: string): Promise<string> {
    const lines: string[] = [];
    for await (const line of this.execStreaming(script)) {
      lines.push(line);
    }
    return lines.join('\n');
  }

  private async ensureProcess(): Promise<void> {
    if (this.process && !this.process.killed) {
      return;
    }

    this.process = spawn('powershell.exe', [
      '-NoProfile',
      '-NoLogo',
      '-NonInteractive',
      '-Command',
      '-' // Read from stdin
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.process.on('error', (err) => {
      console.error('[LocalPowerShellClient] Process error:', err);
      this.process = null;
    });

    this.process.on('exit', () => {
      this.process = null;
    });

    // Ignore stderr
    this.process.stderr?.on('data', () => {});

    // Wait for process to be ready
    await new Promise<void>((resolve) => {
      const onFirstData = (chunk: Buffer) => {
        if (chunk.toString().includes('READY')) {
          this.process!.stdout!.off('data', onFirstData);
          resolve();
        }
      };
      this.process!.stdout!.on('data', onFirstData);
      this.process!.stdin!.write('Write-Host "READY"\n');
    });
  }

  dispose(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
  }
}

// Singleton instance
let instance: LocalPowerShellClient | null = null;

export function getLocalPowerShellClient(): LocalPowerShellClient {
  if (!instance) {
    instance = new LocalPowerShellClient();
  }
  return instance;
}

export function disposeLocalPowerShellClient(): void {
  instance?.dispose();
  instance = null;
}