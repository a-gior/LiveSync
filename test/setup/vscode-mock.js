/**
 * Mock VSCode module for tests
 * This runs BEFORE any imports, creating a fake 'vscode' module
 */

const vscode = {
  window: {
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
    createOutputChannel: (name) => ({
      appendLine: () => {},
      show: () => {},
      dispose: () => {},
      name: name,
    }),
    activeTextEditor: undefined,
  },
  commands: {
    executeCommand: () => Promise.resolve(undefined),
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({
      get: () => undefined,
      has: () => false,
      update: () => Promise.resolve(),
    }),
  },
  Uri: {
    file: (path) => ({ 
      fsPath: path, 
      path: path,
      scheme: 'file',
    }),
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
};

// Create a fake module entry for 'vscode' in the cache
// Use a fake path that won't conflict
const Module = require('module');

// Override the require function to return our mock when 'vscode' is requested
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return vscode;
  }
  return originalRequire.apply(this, arguments);
};

console.log('✓ VSCode mock loaded');