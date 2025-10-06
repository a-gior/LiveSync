import * as fs from 'fs';
import { createHash } from 'crypto';

/**
 * Compute a sha1 hash for a local file path on disk.
 * Uses streams, fine for large files.
 */
export async function sha1OfFile(fsPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = fs.createReadStream(fsPath);
    stream.on('data', (chunk) => { hash.update(chunk); });
    stream.on('error', (error) => { reject(error); });
    stream.on('end', () => { resolve(hash.digest('hex')); });
  });
}
