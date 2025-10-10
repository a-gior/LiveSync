import { strict as assert } from 'assert';
import { sortByDepthDesc } from '../../src/infrastructure/remote/PathUtils';

describe('sortByDepthDesc', () => {
  it('sorts deeper paths first', () => {
    const paths = ['a', 'a/b', 'a/b/c', 'd/e', 'd'];
    const sorted = sortByDepthDesc(paths);
    assert.deepEqual(sorted, ['a/b/c', 'a/b', 'd/e', 'a', 'd']);
  });
});
