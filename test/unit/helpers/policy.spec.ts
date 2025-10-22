import { strict as assert } from 'assert';
import { parseActionPolicy } from '../../../src/infrastructure/helpers/policy';

describe('Policy Parser (parseActionPolicy)', () => {
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

    it('returns empty policy for empty string', () => {
      const policy = parseActionPolicy('');
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

    it('returns empty policy for whitespace only', () => {
      const policy = parseActionPolicy('   \t\n  ');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });
  });

  describe('Check-Only Policy', () => {
    it('parses "check" as check-only policy', () => {
      const policy = parseActionPolicy('check');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });

    it('handles "CHECK" (case insensitive)', () => {
      const policy = parseActionPolicy('CHECK');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, undefined);
    });

    it('handles "ChEcK" (mixed case)', () => {
      const policy = parseActionPolicy('ChEcK');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, undefined);
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

    it('handles case insensitivity for upload actions', () => {
      assert.equal(parseActionPolicy('SAVE').direction, 'upload');
      assert.equal(parseActionPolicy('UPLOAD').direction, 'upload');
      assert.equal(parseActionPolicy('CREATE').direction, 'upload');
    });
  });

  describe('Download Direction', () => {
    it('parses "download" as download', () => {
      const policy = parseActionPolicy('download');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'download');
      assert.equal(policy.extras.size, 0);
    });

    it('parses "pull" as download', () => {
      const policy = parseActionPolicy('pull');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'download');
      assert.equal(policy.extras.size, 0);
    });

    it('parses "get" as download', () => {
      const policy = parseActionPolicy('get');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'download');
      assert.equal(policy.extras.size, 0);
    });

    it('handles case insensitivity for download actions', () => {
      assert.equal(parseActionPolicy('DOWNLOAD').direction, 'download');
      assert.equal(parseActionPolicy('PULL').direction, 'download');
      assert.equal(parseActionPolicy('GET').direction, 'download');
    });
  });

  describe('Delete Extra', () => {
    it('parses "delete" as delete extra', () => {
      const policy = parseActionPolicy('delete');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.ok(policy.extras.has('delete'));
    });

    it('parses "remove" as delete extra', () => {
      const policy = parseActionPolicy('remove');
      assert.ok(policy.extras.has('delete'));
    });

    it('parses "rm" as delete extra', () => {
      const policy = parseActionPolicy('rm');
      assert.ok(policy.extras.has('delete'));
    });

    it('handles case insensitivity', () => {
      assert.ok(parseActionPolicy('DELETE').extras.has('delete'));
      assert.ok(parseActionPolicy('REMOVE').extras.has('delete'));
      assert.ok(parseActionPolicy('RM').extras.has('delete'));
    });
  });

  describe('Rename Extra', () => {
    it('parses "move" as rename extra', () => {
      const policy = parseActionPolicy('move');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.ok(policy.extras.has('rename'));
    });

    it('parses "rename" as rename extra', () => {
      const policy = parseActionPolicy('rename');
      assert.ok(policy.extras.has('rename'));
    });

    it('parses "mv" as rename extra', () => {
      const policy = parseActionPolicy('mv');
      assert.ok(policy.extras.has('rename'));
    });

    it('handles case insensitivity', () => {
      assert.ok(parseActionPolicy('MOVE').extras.has('rename'));
      assert.ok(parseActionPolicy('RENAME').extras.has('rename'));
      assert.ok(parseActionPolicy('MV').extras.has('rename'));
    });
  });

  describe('Combined Policies with &', () => {
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

    it('parses "check&delete" as check + delete extra', () => {
      const policy = parseActionPolicy('check&delete');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, undefined);
      assert.ok(policy.extras.has('delete'));
    });

    it('parses "check&move" as check + rename extra', () => {
      const policy = parseActionPolicy('check&move');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, undefined);
      assert.ok(policy.extras.has('rename'));
    });

    it('parses "check&create" as check + upload', () => {
      const policy = parseActionPolicy('check&create');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });
  });

  describe('Whitespace Handling', () => {
    it('handles leading/trailing whitespace', () => {
      const policy = parseActionPolicy('  save  ');
      assert.equal(policy.direction, 'upload');
    });

    it('handles whitespace around &', () => {
      const policy = parseActionPolicy('check & save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('handles multiple spaces', () => {
      const policy = parseActionPolicy('  check   &   upload  ');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('handles tabs and newlines', () => {
      const policy = parseActionPolicy('\tcheck\n&\tsave\n');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });
  });

  describe('Multiple Tokens', () => {
    it('last direction wins when multiple directions specified', () => {
      // First upload, then download -> download wins
      const policy = parseActionPolicy('upload&download');
      assert.equal(policy.direction, 'download');
    });

    it('can combine multiple extras', () => {
      const policy = parseActionPolicy('delete&move');
      assert.ok(policy.extras.has('delete'));
      assert.ok(policy.extras.has('rename'));
    });

    it('can combine check + direction + extras', () => {
      const policy = parseActionPolicy('check&save&delete');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
      assert.ok(policy.extras.has('delete'));
    });
  });

  describe('Unknown Tokens', () => {
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

    it('treats numbers as unknown and ignores them', () => {
      const policy = parseActionPolicy('123&save');
      assert.equal(policy.direction, 'upload');
    });
  });

  describe('Real-World Policy Strings', () => {
    it('handles typical save policy', () => {
      const policy = parseActionPolicy('check&save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('handles typical open policy', () => {
      const policy = parseActionPolicy('check&download');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'download');
    });

    it('handles typical delete policy', () => {
      const policy = parseActionPolicy('check&delete');
      assert.equal(policy.check, true);
      assert.ok(policy.extras.has('delete'));
    });

    it('handles typical move policy', () => {
      const policy = parseActionPolicy('check&move');
      assert.equal(policy.check, true);
      assert.ok(policy.extras.has('rename'));
    });

    it('handles direct action without check', () => {
      const policy = parseActionPolicy('upload');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, 'upload');
    });

    it('handles disabled action', () => {
      const policy = parseActionPolicy('none');
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
      assert.equal(policy.extras.size, 0);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty tokens after splitting', () => {
      const policy = parseActionPolicy('&&save&&');
      assert.equal(policy.direction, 'upload');
    });

    it('handles duplicate tokens', () => {
      const policy = parseActionPolicy('check&check&save&save');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('handles mixed case with special characters', () => {
      const policy = parseActionPolicy('ChEcK&SaVe');
      assert.equal(policy.check, true);
      assert.equal(policy.direction, 'upload');
    });

    it('converts non-string inputs to string', () => {
      const policy = parseActionPolicy(123 as any);
      assert.equal(policy.check, false);
      assert.equal(policy.direction, undefined);
    });
  });

  describe('Policy Equivalence', () => {
    it('"save", "upload", and "create" are equivalent', () => {
      const p1 = parseActionPolicy('save');
      const p2 = parseActionPolicy('upload');
      const p3 = parseActionPolicy('create');
      
      assert.equal(p1.direction, p2.direction);
      assert.equal(p2.direction, p3.direction);
    });

    it('"download", "pull", and "get" are equivalent', () => {
      const p1 = parseActionPolicy('download');
      const p2 = parseActionPolicy('pull');
      const p3 = parseActionPolicy('get');
      
      assert.equal(p1.direction, p2.direction);
      assert.equal(p2.direction, p3.direction);
    });

    it('"delete", "remove", and "rm" are equivalent', () => {
      const p1 = parseActionPolicy('delete');
      const p2 = parseActionPolicy('remove');
      const p3 = parseActionPolicy('rm');
      
      assert.ok(p1.extras.has('delete'));
      assert.ok(p2.extras.has('delete'));
      assert.ok(p3.extras.has('delete'));
    });

    it('"move", "rename", and "mv" are equivalent', () => {
      const p1 = parseActionPolicy('move');
      const p2 = parseActionPolicy('rename');
      const p3 = parseActionPolicy('mv');
      
      assert.ok(p1.extras.has('rename'));
      assert.ok(p2.extras.has('rename'));
      assert.ok(p3.extras.has('rename'));
    });
  });
});