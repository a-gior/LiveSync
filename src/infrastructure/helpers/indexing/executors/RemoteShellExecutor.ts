/**
 * Remote shell executor using SSH with streaming support
 */

import type { Client as SSHClient, ClientChannel } from 'ssh2';
import * as readline from 'readline';

/**
 * Execute SSH command and return full output (buffered)
 */
export function execSSH(client: SSHClient, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    
    client.exec(cmd, (err, stream) => {
      if (err) {return reject(err);}
      
      stream
        .on('data', (chunk: Buffer) => { output += chunk.toString(); })
        .stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); })
        .on('close', () => resolve(output))
        .on('error', reject);
    });
  });
}

/**
 * Execute SSH command and stream lines as they arrive
 */
export async function* execSSHStreaming(
  client: SSHClient,
  cmd: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, undefined> {
  // Get the stream from SSH
  const stream = await new Promise<ClientChannel>((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) {return reject(err);}
      resolve(stream);
    });
  });

  // Handle abort
  if (signal) {
    const abortHandler = () => {
      stream.close();
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  }

  // Create readline interface for line-by-line processing
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      if (signal?.aborted) {break;}
      yield line;
    }
  } finally {
    rl.close();
  }
}