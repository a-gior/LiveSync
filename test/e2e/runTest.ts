/**
 * E2E Test Runner
 * Runs tests inside actual VSCode instance
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { runTests } from '@vscode/test-electron';

async function main() {
  let userDataDir: string | undefined;
  let extensionsDir: string | undefined;

  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Create isolated dirs so VS Code doesn't reuse "recent folders" from past runs
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'livesync-e2e-user-'));
    extensionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'livesync-e2e-ext-'));

    console.log('Starting E2E tests in VSCode...');
    console.log('Extension path:', extensionDevelopmentPath);
    console.log('Test path:', extensionTestsPath);
    console.log('User data dir:', userDataDir);
    console.log('Extensions dir:', extensionsDir);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--disable-extensions', // Disable other extensions
        '--disable-gpu',
        '--skip-welcome',
        '--skip-release-notes',
      ],
    });

    console.log('✓ E2E tests completed successfully');
  } catch (err) {
    console.error('❌ Failed to run E2E tests');
    console.error(err);
    process.exitCode = 1;
  } finally {
    // Clean up after VS Code exits
    const rmOpts = { recursive: true, force: true } as const;
    if (userDataDir) await fs.rm(userDataDir, rmOpts).catch(() => {});
    if (extensionsDir) await fs.rm(extensionsDir, rmOpts).catch(() => {});
  }
}

main();
