import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'os';
import { join } from 'path';

// Create unique temp dirs for each test run to avoid workspace history pollution
const timestamp = Date.now();
const userDataDir = join(tmpdir(), `livesync-test-user-${timestamp}`);
const extensionsDir = join(tmpdir(), `livesync-test-ext-${timestamp}`);

export default defineConfig({
  files: 'out/test/e2e/suite/**/*.spec.js',
  workspaceFolder: './test/fixtures/test-workspace',
  mocha: {
    ui: 'tdd',
    timeout: 60000,
    require: ['./out/test/e2e/globalSetup.js']
  },
  launchArgs: [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
  ],
});