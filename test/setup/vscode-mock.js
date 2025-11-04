/**
 * Mock VSCode API for unit tests
 * This file provides minimal mocks of the vscode module so tests can run in Node.js
 */

// Mock Uri class
class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
  }
  static file(path) {
    return new Uri(path);
  }
}

// Mock FileType enum
const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64
};

// Mock workspace
const workspace = {
  workspaceFolders: undefined,
  getWorkspaceFolder: () => undefined,
  fs: {
    stat: async () => ({ type: FileType.File }),
    createDirectory: async () => {},
    readFile: async () => Buffer.from(''),
    writeFile: async () => {}
  },
  onWillCreateFiles: () => ({ dispose: () => {} }),
  onWillDeleteFiles: () => ({ dispose: () => {} }),
  onWillRenameFiles: () => ({ dispose: () => {} }),
  onWillSaveTextDocument: () => ({ dispose: () => {} }),
  onDidCreateFiles: () => ({ dispose: () => {} }),
  onDidDeleteFiles: () => ({ dispose: () => {} }),
  onDidRenameFiles: () => ({ dispose: () => {} }),
  onDidSaveTextDocument: () => ({ dispose: () => {} }),
  onDidOpenTextDocument: () => ({ dispose: () => {} }),
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {}
  })
};

// Mock window
const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async () => undefined,
  setStatusBarMessage: () => ({ dispose: () => {} }),
  createOutputChannel: () => ({
    appendLine: () => {},
    append: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {}
  }),
  createTreeView: () => ({
    reveal: async () => {},
    dispose: () => {}
  })
};

// Mock commands
const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => undefined
};

// Export mocked vscode module
module.exports = {
  Uri,
  FileType,
  workspace,
  window,
  commands,
  // Add other commonly used vscode exports as needed
  Disposable: class {
    dispose() {}
  },
  EventEmitter: class {
    event = () => ({ dispose: () => {} });
    fire() {}
    dispose() {}
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  }
};