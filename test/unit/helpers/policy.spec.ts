import { strict as assert } from 'assert';
import { parseActionPolicy } from '@helpers/policy/parser';

describe('Policy Parser', () => {
  describe('No Action Cases', () => {
    it('returns none policy for undefined', () => {
      const policy = parseActionPolicy(undefined);
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });

    it('returns none policy for null', () => {
      const policy = parseActionPolicy(null);
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });

    it('returns none policy for "none"', () => {
      const policy = parseActionPolicy('none');
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });

    it('returns none policy for "off"', () => {
      const policy = parseActionPolicy('off');
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });

    it('returns none policy for empty string', () => {
      const policy = parseActionPolicy('');
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });
  });

  describe('Upload Action', () => {
    it('parses "save" as upload action', () => {
      const policy = parseActionPolicy('save');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'upload');
    });

    it('parses "upload" as upload action', () => {
      const policy = parseActionPolicy('upload');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'upload');
    });

    it('parses "create" as upload action', () => {
      const policy = parseActionPolicy('create');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'upload');
    });
  });

  describe('Download Action', () => {
    it('parses "download" as download action', () => {
      const policy = parseActionPolicy('download');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'download');
    });

    it('parses "open" as download action', () => {
      const policy = parseActionPolicy('open');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'download');
    });
  });

  describe('Delete Action', () => {
    it('parses "delete" as delete action', () => {
      const policy = parseActionPolicy('delete');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'delete');
    });
  });

  describe('Move Action', () => {
    it('parses "move" as move action', () => {
      const policy = parseActionPolicy('move');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'move');
    });
  });

  describe('Check Flag', () => {
    it('parses "check&save" as check&action upload', () => {
      const policy = parseActionPolicy('check&save');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('parses "check&upload" as check&action upload', () => {
      const policy = parseActionPolicy('check&upload');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('parses "check&download" as check&action download', () => {
      const policy = parseActionPolicy('check&download');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'download');
    });

    it('parses "check&create" as check&action upload', () => {
      const policy = parseActionPolicy('check&create');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('parses "check&delete" as check&action delete', () => {
      const policy = parseActionPolicy('check&delete');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'delete');
    });

    it('parses "check&move" as check&action move', () => {
      const policy = parseActionPolicy('check&move');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'move');
    });

    it('handles order independence: "save&check"', () => {
      const policy = parseActionPolicy('save&check');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('handles whitespace in combined policies', () => {
      const policy = parseActionPolicy('check & save');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });
  });

  describe('Real-World Scenarios', () => {
    it('parses actionOnSave: "check&save"', () => {
      const policy = parseActionPolicy('check&save');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('parses actionOnCreate: "check&create"', () => {
      const policy = parseActionPolicy('check&create');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('parses actionOnOpen: "check&download"', () => {
      const policy = parseActionPolicy('check&download');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'download');
    });

    it('parses actionOnDelete: "none"', () => {
      const policy = parseActionPolicy('none');
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });

    it('parses actionOnMove: "check&move"', () => {
      const policy = parseActionPolicy('check&move');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'move');
    });

    it('parses direct upload: "upload"', () => {
      const policy = parseActionPolicy('upload');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'upload');
    });

    it('parses direct delete: "delete"', () => {
      const policy = parseActionPolicy('delete');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'delete');
    });
  });

  describe('Edge Cases', () => {
    it('ignores unknown tokens', () => {
      const policy = parseActionPolicy('foobar');
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });

    it('ignores unknown tokens mixed with valid ones', () => {
      const policy = parseActionPolicy('foobar&save');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'upload');
    });

    it('ignores unknown tokens with check', () => {
      const policy = parseActionPolicy('check&foobar&save');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('handles empty tokens from multiple separators', () => {
      const policy = parseActionPolicy('&&save&&');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'upload');
    });

    it('handles duplicate tokens', () => {
      const policy = parseActionPolicy('check&check&save&save');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('converts non-string to string', () => {
      const policy = parseActionPolicy(123 as any);
      // "123" doesn't match any patterns
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });

    it('handles mixed case', () => {
      const policy = parseActionPolicy('ChEcK&SaVe');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('handles extra whitespace', () => {
      const policy = parseActionPolicy('  check  &  save  ');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'upload');
    });

    it('none/off overrides everything else', () => {
      const policy = parseActionPolicy('check&save&none');
      assert.equal(policy.mode, 'none');
      assert.equal(policy.action, 'skip');
    });
  });

  describe('Check-Only Policy', () => {
    it('parses "check" alone as check-only', () => {
      const policy = parseActionPolicy('check');
      assert.equal(policy.mode, 'check');
      assert.equal(policy.action, 'skip');
    });
  });

  describe('Multiple Actions (Last One Wins)', () => {
    it('parses "delete&move" with last action winning', () => {
      const policy = parseActionPolicy('delete&move');
      assert.equal(policy.mode, 'action');
      // Last action in the string wins
      assert.equal(policy.action, 'move');
    });

    it('parses "upload&download" with last action winning', () => {
      const policy = parseActionPolicy('upload&download');
      assert.equal(policy.mode, 'action');
      assert.equal(policy.action, 'download');
    });

    it('parses "check&delete&move" with check and last action', () => {
      const policy = parseActionPolicy('check&delete&move');
      assert.equal(policy.mode, 'check&action');
      assert.equal(policy.action, 'move');
    });
  });
});