/**
 * OS-specific command builders
 */

export { buildLinuxCommands } from './linux';
export type { CommandSet } from './linux';

export { buildDarwinCommands } from './darwin';

export { buildWindowsCountCommand, buildWindowsScanCommand, escapeScriptForSSH } from './windows';