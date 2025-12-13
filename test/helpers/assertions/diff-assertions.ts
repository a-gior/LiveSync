import { strict as assert } from 'assert';
import type { DiffEntry, DiffStatus, NodeIndex } from '../../../src/domain/types';

export function assertDiffEntry(
  entry: DiffEntry | undefined,
  expected: Partial<DiffEntry>
): void {
  assert.ok(entry, 'Expected diff entry to exist');
  
  if (expected.status !== undefined) {
    assert.equal(entry.status, expected.status, `Expected status ${expected.status}`);
  }
  
  if (expected.type !== undefined) {
    assert.equal(entry.type, expected.type, `Expected type ${expected.type}`);
  }
}

export function assertIndexEquals(actual: NodeIndex, expected: NodeIndex): void {
  assert.equal(actual.size, expected.size, 'Index sizes should match');
  
  for (const [key, value] of expected) {
    assert.ok(actual.has(key), `Expected index to have key: ${key}`);
    const actualValue = actual.get(key)!;
    assert.deepEqual(actualValue, value, `Values for key ${key} should match`);
  }
}
