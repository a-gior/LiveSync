import { createHash } from 'crypto';
import * as fs from 'fs';

/**
 * Compute SHA256 hash of a file (matches remote sha256sum).
 */
export async function sha256OfFile(fsPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(fsPath);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
