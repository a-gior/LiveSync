// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
  {
    label: 'single',
    files: 'out/test/**/*.test.js',
    workspaceFolder: './test/workspace-test/.code-workspaces/livesync-single.code-workspace',
    version: 'stable',
    launchArgs: [
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-updates',
      '--no-sandbox'
    ]
  },
  {
    label: 'multi',
    files: 'out/test/**/*.test.js',
    workspaceFolder: './test/workspace-test/.code-workspaces/livesync-multi.code-workspace',
    version: 'stable',
    launchArgs: [
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-updates',
      '--no-sandbox'
    ]
  }
]);
