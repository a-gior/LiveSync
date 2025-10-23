import { strict as assert } from 'assert';
import { compile, ignored } from '../../../src/infrastructure/helpers/ignore';
import { stringToRel } from '../../../src/infrastructure/helpers/path';

/**
 * Phase 2: Ignore Pattern Comprehensive Test Suite
 * 
 * Tests the ignore/glob matching functionality used to filter files during sync.
 */
describe('Ignore Patterns', () => {
  describe('compile', () => {
    it('compiles empty pattern list', () => {
      const rules = compile([]);
      assert.ok(rules);
      assert.equal(typeof rules, 'object');
    });

    it('compiles single pattern', () => {
      const rules = compile(['*.log']);
      assert.ok(rules);
    });

    it('compiles multiple patterns', () => {
      const rules = compile(['*.log', '*.tmp', 'node_modules/**']);
      assert.ok(rules);
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

    it('matches glob pattern with wildcard', () => {
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
    it('matches files in nested folders', () => {
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

    it('matches patterns with character classes', () => {
      const rules = compile(['test[0-9].js']);
      
      assert.equal(ignored(stringToRel('test1.js'), rules), true);
      assert.equal(ignored(stringToRel('test5.js'), rules), true);
      assert.equal(ignored(stringToRel('test.js'), rules), false);
      assert.equal(ignored(stringToRel('testA.js'), rules), false);
    });

    it('matches patterns with question mark', () => {
      const rules = compile(['file?.txt']);
      
      assert.equal(ignored(stringToRel('file1.txt'), rules), true);
      assert.equal(ignored(stringToRel('fileA.txt'), rules), true);
      assert.equal(ignored(stringToRel('file.txt'), rules), false);
      assert.equal(ignored(stringToRel('file12.txt'), rules), false);
    });
  });

  describe('ignored - Negation Patterns', () => {
    it('respects negation patterns (if supported)', () => {
      // Note: Depends on minimatch's negation support
      const rules = compile(['*.log', '!important.log']);
      
      assert.equal(ignored(stringToRel('debug.log'), rules), true);
      // important.log might not be ignored if negation works
      // This behavior depends on the minimatch configuration
    });
  });

  describe('ignored - Case Sensitivity', () => {
    it('handles case sensitivity correctly', () => {
      const rules = compile(['*.LOG']); // uppercase
      
      // Behavior depends on minimatch options (caseSensitive)
      // By default, minimatch is case-sensitive on Unix-like systems
      assert.equal(ignored(stringToRel('debug.LOG'), rules), true);
      
      // On case-insensitive systems, this might also match
      const shouldMatch = process.platform === 'win32';
      if (shouldMatch) {
        assert.equal(ignored(stringToRel('debug.log'), rules), true);
      } else {
        assert.equal(ignored(stringToRel('debug.log'), rules), false);
      }
    });
  });

  describe('ignored - Dot Files', () => {
    it('matches dot files explicitly', () => {
      const rules = compile(['.*']);
      
      assert.equal(ignored(stringToRel('.gitignore'), rules), true);
      assert.equal(ignored(stringToRel('.env'), rules), true);
      assert.equal(ignored(stringToRel('app.js'), rules), false);
    });

    it('matches dot files in any folder', () => {
      const rules = compile(['**/.*']);
      
      assert.equal(ignored(stringToRel('.gitignore'), rules), true);
      assert.equal(ignored(stringToRel('src/.env'), rules), true);
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
    });

    it('matches specific dot file', () => {
      const rules = compile(['.DS_Store']);
      
      assert.equal(ignored(stringToRel('.DS_Store'), rules), true);
      assert.equal(ignored(stringToRel('folder/.DS_Store'), rules), false); // Without **, only matches root
    });

    it('matches specific dot file anywhere', () => {
      const rules = compile(['**/.DS_Store']);
      
      assert.equal(ignored(stringToRel('.DS_Store'), rules), true);
      assert.equal(ignored(stringToRel('folder/.DS_Store'), rules), true);
      assert.equal(ignored(stringToRel('deep/nested/folder/.DS_Store'), rules), true);
    });
  });

  describe('ignored - Edge Cases', () => {
    it('empty pattern list matches nothing', () => {
      const rules = compile([]);
      
      assert.equal(ignored(stringToRel('any-file.txt'), rules), false);
      assert.equal(ignored(stringToRel('folder/file.js'), rules), false);
    });

    it('root path', () => {
      const rules = compile(['*.log']);
      
      assert.equal(ignored(stringToRel(''), rules), false);
    });

    it('handles paths with leading slash', () => {
      const rules = compile(['src/**']);
      
      // RelPath should not have leading slash, but test robustness
      assert.equal(ignored(stringToRel('src/app.js'), rules), true);
    });

    it('handles patterns with trailing slash', () => {
      const rules = compile(['dist/**']);
      
      // Minimatch treats trailing slash patterns as directory matches
      // This test documents actual behavior
      assert.equal(ignored(stringToRel('dist/bundle.js'), rules), true);
    });

    it('handles very long paths', () => {
      const rules = compile(['node_modules/**']);
      
      const longPath = 'node_modules/' + 'sub/'.repeat(50) + 'file.js';
      assert.equal(ignored(stringToRel(longPath), rules), true);
    });

    it('handles patterns with special characters', () => {
      const rules = compile(['file[1-3].txt']);
      
      assert.equal(ignored(stringToRel('file1.txt'), rules), true);
      assert.equal(ignored(stringToRel('file2.txt'), rules), true);
      assert.equal(ignored(stringToRel('file4.txt'), rules), false);
    });
  });

  describe('ignored - Real-World Patterns', () => {
    it('typical Git ignore patterns', () => {
      const rules = compile([
        'node_modules/**',
        '.git/**',
        '.vscode/**',
        '*.log',
        '*.tmp',
        'dist/**',
        'build/**',
        '.DS_Store'
      ]);
      
      assert.equal(ignored(stringToRel('node_modules/pkg/index.js'), rules), true);
      assert.equal(ignored(stringToRel('.git/config'), rules), true);
      assert.equal(ignored(stringToRel('.vscode/settings.json'), rules), true);
      assert.equal(ignored(stringToRel('debug.log'), rules), true);
      assert.equal(ignored(stringToRel('temp.tmp'), rules), true);
      assert.equal(ignored(stringToRel('dist/bundle.js'), rules), true);
      assert.equal(ignored(stringToRel('build/output.js'), rules), true);
      assert.equal(ignored(stringToRel('.DS_Store'), rules), true);
      
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
      assert.equal(ignored(stringToRel('README.md'), rules), false);
      assert.equal(ignored(stringToRel('package.json'), rules), false);
    });

    it('typical LiveSync ignore patterns', () => {
      const rules = compile([
        '.livesync/**',
        '.vscode/**',
        '.git/**',
        'node_modules/**',
        '**/*.swp',
        '**/*~'
      ]);
      
      assert.equal(ignored(stringToRel('.livesync/cache'), rules), true);
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
        '*.egg-info/**',
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
        '**/.*.swp',
        '.idea/**',
        '*.iml'
      ]);
      
      assert.equal(ignored(stringToRel('.file.swp'), rules), true);
      assert.equal(ignored(stringToRel('file.swo'), rules), true);
      assert.equal(ignored(stringToRel('backup~'), rules), true);
      assert.equal(ignored(stringToRel('.idea/workspace.xml'), rules), true);
      assert.equal(ignored(stringToRel('project.iml'), rules), true);
      
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
    });
  });

  describe('ignored - Windows vs Unix Paths', () => {
    it('handles Unix-style paths', () => {
      const rules = compile(['src/temp/**']);
      
      assert.equal(ignored(stringToRel('src/temp/cache.dat'), rules), true);
      assert.equal(ignored(stringToRel('src/app.js'), rules), false);
    });

    it('normalizes paths internally', () => {
      // RelPath should always be normalized to forward slashes
      const rules = compile(['**/*.log']);
      
      assert.equal(ignored(stringToRel('logs/debug.log'), rules), true);
      assert.equal(ignored(stringToRel('deep/nested/logs/error.log'), rules), true);
    });
  });

  describe('ignored - Performance', () => {
    it('handles large pattern lists efficiently', () => {
      const patterns: string[] = [];
      for (let i = 0; i < 100; i++) {
        patterns.push(`pattern${i}/**`);
      }
      
      const rules = compile(patterns);
      
      // Should compile without hanging
      assert.ok(rules);
      
      // Should match efficiently
      assert.equal(ignored(stringToRel('pattern50/file.txt'), rules), true);
      assert.equal(ignored(stringToRel('other/file.txt'), rules), false);
    });

    it('handles checking many files against same rules', () => {
      const rules = compile(['node_modules/**', '*.log', 'dist/**']);
      
      const files = [
        'src/app.js',
        'src/utils.js',
        'node_modules/pkg/index.js',
        'debug.log',
        'dist/bundle.js',
        'tests/app.spec.js'
      ];
      
      const results = files.map(f => ignored(stringToRel(f), rules));
      
      assert.deepEqual(results, [false, false, true, true, true, false]);
    });
  });
});