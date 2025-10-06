import { strict as assert } from 'assert';
import { maybeActByPolicyCore } from '../../src/presentation/events/autoActions.core';
import { parseActionPolicy } from '../../src/infrastructure/config/ActionPolicy';

class FakeRemote {
  uploaded: string[] = [];
  downloaded: string[] = [];
  index = new Map<string, { type: 'file'; hash: string }>();
  async list() { return new Map(this.index); }
  async uploadFile(_ws: string, rel: string, _abs: string) { this.uploaded.push(rel); this.index.set(rel, { type: 'file', hash: 'U' }); }
  async deletePath() {}
  async downloadFile(_ws: string, rel: string, _abs: string) { this.downloaded.push(rel); }
}

describe('autoActions.core maybeActByPolicyCore', () => {
  const ws = '/ws';
  const joinFs = (w: string, r: string) => `${w}/${r}`;
  const sha1 = async (_: string) => 'HASH';

  it('uploads on check&save when modified', async () => {
    const remote = new FakeRemote();
    const state = {
      getDiffEntry: (_: string, __: string) => ({ type: 'file', status: 'modified' as const }),
      setRemoteIndex: () => void 0,
      applyLocal: () => void 0
    } as any;

    await maybeActByPolicyCore(state, remote as any, ws, 'a.txt', parseActionPolicy('check&save'), joinFs, sha1);
    assert.deepEqual(remote.uploaded, ['a.txt']);
  });

  it('downloads on check&download when removed', async () => {
    const remote = new FakeRemote();
    const state = {
      getDiffEntry: (_: string, __: string) => ({ type: 'file', status: 'removed' as const }),
      setRemoteIndex: () => void 0,
      applyLocal: () => void 0
    } as any;

    await maybeActByPolicyCore(state, remote as any, ws, 'gone.txt', parseActionPolicy('check&download'), joinFs, sha1);
    assert.deepEqual(remote.downloaded, ['gone.txt']);
  });
});
