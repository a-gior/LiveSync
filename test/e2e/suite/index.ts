/**
 * E2E Test Suite Index
 * Configures Mocha and imports all E2E tests
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
  // Create Mocha instance
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 60000, // E2E tests need longer timeout
    slow: 5000,
  });

  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    // Find all test files
    glob('**/**.spec.js', { cwd: testsRoot })
      .then((files) => {
        console.log(`Found ${files.length} E2E test files`);
        
        // Add files to test suite
        files.forEach((f) => {
          const testFile = path.resolve(testsRoot, f);
          console.log(`  - ${f}`);
          mocha.addFile(testFile);
        });

        // Run the tests
        mocha.run((failures) => {
          if (failures > 0) {
            reject(new Error(`${failures} tests failed.`));
          } else {
            resolve();
          }
        });
      })
      .catch((err) => {
        console.error('Error finding test files:', err);
        reject(err);
      });
  });
}