import { strict as assert } from 'assert';
import { computeRefreshTarget } from '../../src/presentation/tree/refresh/RefreshPlanner';

describe('RefreshPlanner.computeRefreshTarget', () => {
  it('refreshes file when entry exists and node realized', () => {
    const realized = new Set(['src/a.txt', 'src']);
    const d = computeRefreshTarget({
      changedPath: 'src/a.txt',
      parentPath: 'src',
      entryStillExists: true,
      realizedPaths: realized
    });
    assert.deepEqual(d, { kind: 'file', path: 'src/a.txt' });
  });

  it('refreshes parent on delete', () => {
    const realized = new Set(['src']);
    const d = computeRefreshTarget({
      changedPath: 'src/a.txt',
      parentPath: 'src',
      entryStillExists: false,
      realizedPaths: realized
    });
    assert.deepEqual(d, { kind: 'parent', path: 'src' });
  });

  it('falls back to workspace when neither realized', () => {
    const d = computeRefreshTarget({
      changedPath: 'src/a.txt',
      parentPath: 'src',
      entryStillExists: false,
      realizedPaths: new Set()
    });
    assert.deepEqual(d, { kind: 'workspace' });
  });

  it('prefers parent when child not realized yet (create)', () => {
    const realized = new Set(['src']);
    const d = computeRefreshTarget({
      changedPath: 'src/new.txt',
      parentPath: 'src',
      entryStillExists: true,
      realizedPaths: realized
    });
    assert.deepEqual(d, { kind: 'parent', path: 'src' });
  });
});
