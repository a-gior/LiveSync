/**
 * Local shell executor for Linux/macOS with streaming support
 */

import { spawn } from 'child_process';
import * as readline from 'readline';

/**
 * Execute bash command and return full output (buffered)
 */
export function execBash(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', cmd], { 
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false 
    });
    
    let stdout = '';
    
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', () => { /* ignore stderr */ });
    
    proc.on('close', () => {
      // Don't reject on non-zero - commands like find return 1 on permission errors
      resolve(stdout);
    });
    
    proc.on('error', reject);
  });
}

/**
 * Execute bash command and stream lines as they arrive
 */
export async function* execBashStreaming(
  cmd: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, undefined> {
  const proc = spawn('bash', ['-c', cmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });

  // Handle abort
  if (signal) {
    const abortHandler = () => proc.kill('SIGTERM');
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  const rl = readline.createInterface({
    input: proc.stdout,
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      if (signal?.aborted) {break;}
      yield line;
    }
  } finally {
    rl.close();
    if (!proc.killed) {
      proc.kill();
    }
  }
}