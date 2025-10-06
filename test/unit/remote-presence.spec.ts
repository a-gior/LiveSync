import { strict as assert } from 'assert';
import { decidePresence } from '../../src/extension/remotePresence.logic';

describe('remotePresence.decidePresence', () => {
  it('no workspace', () => {
    const r = decidePresence([], 0);
    assert.equal(r.supportsDownload, false);
    assert.equal(r.hint, undefined);
  });
  it('single workspace w/o remote', () => {
    const r = decidePresence([false], 1);
    assert.equal(r.supportsDownload, false);
    assert.equal(r.hint, 'local snapshot');
  });
  it('single workspace with remote', () => {
    const r = decidePresence([true], 1);
    assert.equal(r.supportsDownload, true);
  });
  it('multi-root some remotes', () => {
    const r = decidePresence([true, false, true], 3);
    assert.equal(r.supportsDownload, true);
    assert.equal(r.hint, '2/3 remotes');
  });
});
