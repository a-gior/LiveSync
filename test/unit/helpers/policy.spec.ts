import { strict as assert } from 'assert';
import { parseActionPolicy } from '@helpers/policy/parser';

describe('Policy Parser', () => {
  describe('No Action Cases', () => {
    it('returns empty policy for undefined', () => {
      const policy = parseActionPolicy(undefined);
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('returns empty policy for null', () => {
      const policy = parseActionPolicy(null);
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('returns empty policy for "none"', () => {
      const policy = parseActionPolicy('none');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('returns empty policy for "off"', () => {
      const policy = parseActionPolicy('off');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('returns empty policy for empty string', () => {
      const policy = parseActionPolicy('');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });
  });

  describe('Upload Direction', () => {
    it('parses "save" as upload', () => {
      const policy = parseActionPolicy('save');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'upload');
      assert.equal(policy.extras.size, 0);
    });

    it('parses "upload" as upload', () => {
      const policy = parseActionPolicy('upload');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'upload');
      assert.equal(policy.extras.size, 0);
    });

    it('parses "create" as upload', () => {
      const policy = parseActionPolicy('create');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'upload');
      assert.equal(policy.extras.size, 0);
    });
  });

  describe('Download Direction', () => {
    it('parses "download" as download', () => {
      const policy = parseActionPolicy('download');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'download');
      assert.equal(policy.extras.size, 0);
    });

  });

  describe('Delete Extra', () => {
    it('parses "delete" as delete extra', () => {
      const policy = parseActionPolicy('delete');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.ok(policy.extras.has('delete'));
    });
  });

  describe('Move/Rename Extra', () => {
    it('parses "move" as move extra', () => {
      const policy = parseActionPolicy('move');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.ok(policy.extras.has('move'));
    });

    it('parses "move" as move extra', () => {
      const policy = parseActionPolicy('move');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.ok(policy.extras.has('move'));
    });

  });

  describe('Combined Policies', () => {
    it('parses "check&save" as check + upload', () => {
      const policy = parseActionPolicy('check&save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
      assert.equal(policy.extras.size, 0);
    });

    it('parses "check&upload" as check + upload', () => {
      const policy = parseActionPolicy('check&upload');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('parses "check&download" as check + download', () => {
      const policy = parseActionPolicy('check&download');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'download');
    });

    it('parses "check&delete" as check + delete', () => {
      const policy = parseActionPolicy('check&delete');
      assert.equal(policy.check, true);
      assert.ok(policy.extras.has('delete'));
    });

    it('parses "check&move" as check + move', () => {
      const policy = parseActionPolicy('check&move');
      assert.equal(policy.check, true);
      assert.ok(policy.extras.has('move'));
    });

    it('handles order independence: "save&check"', () => {
      const policy = parseActionPolicy('save&check');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('handles whitespace in combined policies', () => {
      const policy = parseActionPolicy('check & save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });
  });

  describe('Real-World Scenarios', () => {
    it('parses actionOnSave: "check&save"', () => {
      const policy = parseActionPolicy('check&save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('parses actionOnCreate: "check&create"', () => {
      const policy = parseActionPolicy('check&create');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('parses actionOnOpen: "check&download"', () => {
      const policy = parseActionPolicy('check&download');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'download');
    });

    it('parses actionOnDelete: "none"', () => {
      const policy = parseActionPolicy('none');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('parses actionOnMove: "check&move"', () => {
      const policy = parseActionPolicy('check&move');
      assert.equal(policy.check, true);
      assert.ok(policy.extras.has('move'));
    });

    it('parses direct upload: "upload"', () => {
      const policy = parseActionPolicy('upload');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'upload');
    });
  });

  describe('Edge Cases', () => {
    it('ignores unknown tokens', () => {
      const policy = parseActionPolicy('foobar');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('ignores unknown tokens mixed with valid ones', () => {
      const policy = parseActionPolicy('check&foobar&save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('handles empty tokens from multiple separators', () => {
      const policy = parseActionPolicy('&&save&&');
      assert.equal(policy.direction, 'upload');
    });

    it('handles duplicate tokens', () => {
      const policy = parseActionPolicy('check&check&save&save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('converts non-string to string', () => {
      const policy = parseActionPolicy(123 as any);
      // "123" doesn't match any patterns
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
    });

    it('handles mixed case', () => {
      const policy = parseActionPolicy('ChEcK&SaVe');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('handles extra whitespace', () => {
      const policy = parseActionPolicy('  check  &  save  ');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('none/off overrides everything else', () => {
      const policy = parseActionPolicy('check&save&none');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
    });
  });

  describe('Check-Only Policy', () => {
    it('parses "check" alone as check-only', () => {
      const policy = parseActionPolicy('check');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });
  });

  describe('Multiple Extras', () => {
    it('parses "delete&move" with both extras', () => {
      const policy = parseActionPolicy('delete&move');
      assert.ok(policy.extras.has('delete'));
      assert.ok(policy.extras.has('move'));
    });

    it('parses "check&delete&move" with check and both extras', () => {
      const policy = parseActionPolicy('check&delete&move');
      assert.equal(policy.check, true);
      assert.ok(policy.extras.has('delete'));
      assert.ok(policy.extras.has('move'));
    });
  });
});