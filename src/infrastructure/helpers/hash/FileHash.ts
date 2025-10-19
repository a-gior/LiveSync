import { createHash } from 'crypto';
import * as fs from 'fs';

export async function sha1OfFile(fsPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = fs.createReadStream(fsPath);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
