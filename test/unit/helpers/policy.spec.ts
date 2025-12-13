import { strict as assert } from 'assert';
import { parseActionPolicy } from '../../../src/infrastructure/helpers/policy';

describe('Policy Parser', () => {
  describe('No Action Cases', () => {
    it('returns empty policy for undefined', () => {
      const policy = parseActionPolicy(undefined);
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('returns empty policy for "none"', () => {
      // TODO: Implement test
    });
  });

  describe('Upload Direction', () => {
    it('parses "save" as upload', () => {
      // TODO: Implement test
    });

    it('parses "upload" as upload', () => {
      // TODO: Implement test
    });
  });
});
