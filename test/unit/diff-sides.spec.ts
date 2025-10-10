import { strict as assert } from 'assert';
import { computeDiffSides } from '../../src/presentation/diff/computeDiffSides';

describe('computeDiffSides', () => {
  it('added: empty ←→ local', () => {
    const r = computeDiffSides('added');
    assert.deepEqual(r, { left: 'empty', right: 'local' });
  });
  it('removed: remote ←→ empty', () => {
    const r = computeDiffSides('removed');
    assert.deepEqual(r, { left: 'remote', right: 'empty' });
  });
  it('modified: remote ←→ local', () => {
    const r = computeDiffSides('modified');
    assert.deepEqual(r, { left: 'remote', right: 'local' });
  });
  it('conflict: remote ←→ local', () => {
    const r = computeDiffSides('conflict' as any);
    assert.deepEqual(r, { left: 'remote', right: 'local' });
  });
});
