import { createHash } from 'crypto';

export async function sha1FromSftpGetResult(result: unknown): Promise<string> {
  const hash = createHash('sha1');

  if (Buffer.isBuffer(result)) {
    hash.update(result);
    return hash.digest('hex');
  }
  if (typeof result === 'string') {
    hash.update(Buffer.from(result));
    return hash.digest('hex');
  }
  if (result instanceof Uint8Array) {
    hash.update(Buffer.from(result));
    return hash.digest('hex');
  }

  const maybe: any = result as any;
  if (maybe && typeof maybe.on === 'function') {
    return await new Promise<string>((resolve, reject) => {
      maybe.on('data', (chunk: Buffer | string | Uint8Array) => hash.update(chunk as any));
      maybe.on('error', reject);
      maybe.on('end', () => resolve(hash.digest('hex')));
    });
  }

  hash.update(Buffer.from(String(result ?? '')));
  return hash.digest('hex');
}
