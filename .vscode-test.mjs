import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/extension/suite/**/*.test.js',
  workspaceFolder: './test/fixtures/test-workspace',
  mocha: {
    ui: 'tdd',
    timeout: 60000,
  },
  launchArgs: ['--disable-extensions'],
});