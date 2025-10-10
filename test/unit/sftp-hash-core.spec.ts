import { strict as assert } from 'assert';
import { Readable } from 'stream';
import { sha1FromSftpGetResult } from '../../src/infrastructure/remote/SftpHashCore';

function sha1(s: string) {
  // hardcoded SHA1s for tiny literals
  // 'abc' => a9993e364706816aba3e25717850c26c9cd0d89d
  // 'hello' => aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
  return s === 'abc' ? 'a9993e364706816aba3e25717850c26c9cd0d89d'
       : s === 'hello' ? 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
       : '';
}

describe('sha1FromSftpGetResult', () => {
  it('handles Buffer', async () => {
    const r = await sha1FromSftpGetResult(Buffer.from('abc'));
    assert.equal(r, sha1('abc'));
  });
  it('handles string', async () => {
    const r = await sha1FromSftpGetResult('hello');
    assert.equal(r, sha1('hello'));
  });
  it('handles Uint8Array', async () => {
    const r = await sha1FromSftpGetResult(new Uint8Array([97,98,99])); // 'abc'
    assert.equal(r, sha1('abc'));
  });
  it('handles readable stream', async () => {
    const stream = Readable.from(['he', 'll', 'o']);
    const r = await sha1FromSftpGetResult(stream as any);
    assert.equal(r, sha1('hello'));
  });
  it('falls back safely on unknown value', async () => {
    const r = await sha1FromSftpGetResult({ weird: true } as any);
    // just ensure it returns a hex string of length 40 (sha1)
    assert.match(r, /^[0-9a-f]{40}$/);
  });
});
