/**
 * Test setup file - runs before all tests
 * Registers the vscode mock module
 */

const Module = require('module');
const path = require('path');

// Get the original require function
const originalRequire = Module.prototype.require;

// Override require to intercept 'vscode' imports
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    // Return our mock instead
    return originalRequire.call(this, path.join(__dirname, 'vscode-mock.js'));
  }
  // For all other modules, use the original require
  return originalRequire.apply(this, arguments);
};