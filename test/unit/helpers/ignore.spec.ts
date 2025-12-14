import { strict as assert } from 'assert';
import { compile, ignored } from '../../../src/infrastructure/helpers/ignore';
import { stringToRel } from '../../../src/infrastructure/helpers/path';

describe('Ignore Patterns', () => {
  describe('compile', () => {
    it('compiles empty pattern list', () => {
      const rules = compile([]);
      assert.ok(rules);
      assert.ok(Array.isArray(rules));
      assert.equal(rules.length, 0);
    });

    it('compiles single pattern', () => {
      const rules = compile(['*.log']);
      assert.equal(rules.length, 1);
    });

    it('compiles multiple patterns', () => {
      const rules = compile(['*.log', '*.tmp', 'node_modules/**']);
      assert.equal(rules.length, 3);
    });
  });

  describe('ignored - Basic File Patterns', () => {
    it('matches simple file extension', () => {
      const rules = compile(['*.log']);
      
      assert.equal(ignored(stringToRel('debug.log'), rules), true);
      assert.equal(ignored(stringToRel('error.log'), rules), true);
      assert.equal(ignored(stringToRel('app.js'), rules), false);
    });

    it('matches specific filename', () => {
      const rules = compile(['config.json']);
      
      assert.equal(ignored(stringToRel('config.json'), rules), true);
      assert.equal(ignored(stringToRel('other.json'), rules), false);
    });

    it('matches glob with wildcard', () => {
      const rules = compile(['test-*.js']);
      
      assert.equal(ignored(stringToRel('test-utils.js'), rules), true);
      assert.equal(ignored(stringToRel('test-helpers.js'), rules), true);
      assert.equal(ignored(stringToRel('app.js'), rules), false);
    });

    it('matches multiple extensions', () => {
      const rules = compile(['*.log', '*.tmp', '*.cache']);
      
      assert.equal(ignored(stringToRel('debug.log'), rules), true);
      assert.equal(ignored(stringToRel('temp.tmp'), rules), true);
      assert.equal(ignored(stringToRel('data.cache'), rules), true);
      assert.equal(ignored(stringToRel('app.js'), rules), false);
    });
  });

  describe('ignored - Folder Patterns', () => {
    it('matches folder name anywhere in path', () => {
      const rules = compile(['**/node_modules/**']);
      
      assert.equal(ignored(stringToRel('node_modules/pkg/index.js'), rules), true);
      assert.equal(ignored(stringToRel('src/node_modules/pkg/index.js'), rules), true);
      assert.equal(ignored(stringToRel('src/index.js'), rules), false);
    });

    it('matches dot folders', () => {
      const rules = compile(['.git/**', '.vscode/**']);
      
      assert.equal(ignored(stringToRel('.git/config'), rules), true);
      assert.equal(ignored(stringToRel('.vscode/settings.json'), rules), true);
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
    });

    it('matches nested folder structures', () => {
      const rules = compile(['**/test/**']);
      
      assert.equal(ignored(stringToRel('test/unit/app.spec.js'), rules), true);
      assert.equal(ignored(stringToRel('src/test/helpers.js'), rules), true);
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
    });

    it('matches specific path depth', () => {
      const rules = compile(['build/temp/**']);
      
      assert.equal(ignored(stringToRel('build/temp/cache.dat'), rules), true);
      assert.equal(ignored(stringToRel('build/temp/sub/file.txt'), rules), true);
      assert.equal(ignored(stringToRel('build/output.js'), rules), false);
      assert.equal(ignored(stringToRel('temp/file.txt'), rules), false);
    });
  });

  describe('ignored - Complex Patterns', () => {
    it('matches files in nested folders with **', () => {
      const rules = compile(['**/*.log']);
      
      assert.equal(ignored(stringToRel('app.log'), rules), true);
      assert.equal(ignored(stringToRel('logs/error.log'), rules), true);
      assert.equal(ignored(stringToRel('src/utils/debug.log'), rules), true);
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
    });

    it('matches multiple patterns together', () => {
      const rules = compile([
        '*.log',
        '*.tmp',
        'node_modules/**',
        '.git/**',
        'dist/**'
      ]);
      
      assert.equal(ignored(stringToRel('debug.log'), rules), true);
      assert.equal(ignored(stringToRel('temp.tmp'), rules), true);
      assert.equal(ignored(stringToRel('node_modules/pkg/index.js'), rules), true);
      assert.equal(ignored(stringToRel('.git/config'), rules), true);
      assert.equal(ignored(stringToRel('dist/bundle.js'), rules), true);
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
    });

    it('matches folder itself and contents', () => {
      const rules = compile(['.vscode', '.vscode/**']);
      
      assert.equal(ignored(stringToRel('.vscode'), rules), true);
      assert.equal(ignored(stringToRel('.vscode/settings.json'), rules), true);
      assert.equal(ignored(stringToRel('.vscode/launch.json'), rules), true);
    });
  });

  describe('ignored - Real-World Patterns', () => {
    it('JavaScript/Node.js project ignore patterns', () => {
      const rules = compile([
        '.vscode/**',
        '.git/**',
        'node_modules/**',
        '**/*.swp',
        '**/*~'
      ]);
      
      assert.equal(ignored(stringToRel('.vscode/launch.json'), rules), true);
      assert.equal(ignored(stringToRel('.git/HEAD'), rules), true);
      assert.equal(ignored(stringToRel('node_modules/express/index.js'), rules), true);
      assert.equal(ignored(stringToRel('file.swp'), rules), true);
      assert.equal(ignored(stringToRel('backup~'), rules), true);
      
      assert.equal(ignored(stringToRel('src/index.ts'), rules), false);
      assert.equal(ignored(stringToRel('README.md'), rules), false);
    });

    it('Python project ignore patterns', () => {
      const rules = compile([
        '__pycache__/**',
        '*.pyc',
        '*.pyo',
        '**/*.egg-info/**',
        'venv/**',
        '.pytest_cache/**'
      ]);
      
      assert.equal(ignored(stringToRel('__pycache__/module.cpython-39.pyc'), rules), true);
      assert.equal(ignored(stringToRel('app.pyc'), rules), true);
      assert.equal(ignored(stringToRel('module.pyo'), rules), true);
      assert.equal(ignored(stringToRel('myapp.egg-info/PKG-INFO'), rules), true);
      assert.equal(ignored(stringToRel('venv/lib/python3.9/site-packages'), rules), true);
      assert.equal(ignored(stringToRel('.pytest_cache/v/cache'), rules), true);
      
      assert.equal(ignored(stringToRel('app.py'), rules), false);
      assert.equal(ignored(stringToRel('tests/test_app.py'), rules), false);
    });

    it('IDE and editor temporary files', () => {
      const rules = compile([
        '**/*.swp',
        '**/*.swo',
        '**/*~',
        '**/.DS_Store'
      ]);
      
      assert.equal(ignored(stringToRel('file.swp'), rules), true);
      assert.equal(ignored(stringToRel('src/app.ts.swp'), rules), true);
      assert.equal(ignored(stringToRel('backup~'), rules), true);
      assert.equal(ignored(stringToRel('.DS_Store'), rules), true);
      assert.equal(ignored(stringToRel('src/.DS_Store'), rules), true);
    });
  });

  describe('ignored - Case Sensitivity', () => {
    it('matches case insensitively by default', () => {
      const rules = compile(['*.LOG']);
      
      assert.equal(ignored(stringToRel('debug.log'), rules), true);
      assert.equal(ignored(stringToRel('DEBUG.LOG'), rules), true);
      assert.equal(ignored(stringToRel('Error.Log'), rules), true);
    });
  });

  describe('ignored - Path Separators', () => {
    it('handles forward slashes in paths', () => {
      const rules = compile(['src/temp/**']);
      
      assert.equal(ignored(stringToRel('src/temp/file.txt'), rules), true);
      assert.equal(ignored(stringToRel('src/temp/sub/file.txt'), rules), true);
    });

    it('handles backslashes converted to forward slashes', () => {
      const rules = compile(['src\\temp\\**']);
      
      // stringToRel should normalize paths
      assert.equal(ignored('src/temp/file.txt', rules), true);
    });
  });

  describe('ignored - Edge Cases', () => {
    it('handles empty path', () => {
      const rules = compile(['*.log']);
      
      assert.equal(ignored(stringToRel(''), rules), false);
    });

    it('handles dot files specifically', () => {
      const rules = compile(['.env', '.env.*']);
      
      assert.equal(ignored(stringToRel('.env'), rules), true);
      assert.equal(ignored(stringToRel('.env.local'), rules), true);
      assert.equal(ignored(stringToRel('.env.production'), rules), true);
      assert.equal(ignored(stringToRel('src/.env'), rules), false); // Not at root
    });

    it('matches regardless of leading dot in pattern', () => {
      const rules = compile(['.vscode/**']);
      
      assert.equal(ignored(stringToRel('.vscode/settings.json'), rules), true);
    });

    it('handles extremely long paths', () => {
      const rules = compile(['**/*.log']);
      const longPath = 'a/'.repeat(100) + 'file.log';
      
      assert.equal(ignored(stringToRel(longPath), rules), true);
    });
  });

  describe('ignored - Multiple Pattern Matching', () => {
    it('stops at first match (short-circuit)', () => {
      const rules = compile(['*.log', '*.tmp', '*.cache']);
      
      // Should match on first pattern
      assert.equal(ignored(stringToRel('file.log'), rules), true);
    });

    it('tries all patterns if no match', () => {
      const rules = compile(['*.log', '*.tmp']);
      
      assert.equal(ignored(stringToRel('file.js'), rules), false);
    });
  });

  describe('ignored - LiveSync Specific', () => {
    it('ignores .livesync metadata folder', () => {
      const rules = compile(['.livesync/**', '.livesync']);
      
      assert.equal(ignored(stringToRel('.livesync'), rules), true);
      assert.equal(ignored(stringToRel('.livesync/cache.json'), rules), true);
      assert.equal(ignored(stringToRel('.livesync/index.local.json'), rules), true);
    });

    it('ignores .vscode folder', () => {
      const rules = compile(['.vscode/**', '.vscode']);
      
      assert.equal(ignored(stringToRel('.vscode'), rules), true);
      assert.equal(ignored(stringToRel('.vscode/settings.json'), rules), true);
      assert.equal(ignored(stringToRel('.vscode/launch.json'), rules), true);
    });

    it('ignores .git folder', () => {
      const rules = compile(['.git/**', '.git']);
      
      assert.equal(ignored(stringToRel('.git'), rules), true);
      assert.equal(ignored(stringToRel('.git/config'), rules), true);
      assert.equal(ignored(stringToRel('.git/HEAD'), rules), true);
    });
  });
});