import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/e2e/**/*.test.js',
  workspaceFolder: './test/fixtures/workspaces/simple',
  mocha: {
    ui: 'tdd',
    timeout: 60000,
  },
  launchArgs: ['--disable-extensions'],
});
