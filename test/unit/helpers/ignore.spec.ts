import { strict as assert } from 'assert';
import { compile, ignored } from '../../../src/infrastructure/helpers/ignore';
import { stringToRel } from '../../../src/infrastructure/helpers/path';

describe('Ignore Patterns', () => {
  describe('compile', () => {
    it('compiles empty pattern list', () => {
      const rules = compile([]);
      assert.ok(rules);
    });
  });

  describe('ignored - Basic File Patterns', () => {
    it('matches simple file extension', () => {
      const rules = compile(['*.log']);
      
      assert.equal(ignored(stringToRel('debug.log'), rules), true);
      assert.equal(ignored(stringToRel('app.js'), rules), false);
    });
  });

  describe('ignored - Folder Patterns', () => {
    it('matches folder name anywhere in path', () => {
      // TODO: Implement test
    });
  });
});
