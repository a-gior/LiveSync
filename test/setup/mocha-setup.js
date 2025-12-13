/**
 * Mocha global setup for unit and integration tests
 */

// Register ts-node for TypeScript support
require('ts-node/register/transpile-only');

// Register tsconfig-paths for path aliases
require('tsconfig-paths/register');

// Set test timeout
const Mocha = require('mocha');
Mocha.Runner.prototype.timeout = function(ms) {
  if (ms === 0) this._timeout = 0;
  if (ms !== undefined && ms !== null) this._timeout = parseInt(ms, 10);
  return this._timeout;
};
