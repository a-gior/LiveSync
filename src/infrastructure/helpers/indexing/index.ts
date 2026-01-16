/**
 * OS-native index scanning module
 * 
 * Provides fast filesystem scanning using native OS commands:
 * - Windows: PowerShell Get-ChildItem + Get-FileHash
 * - Linux: find + sha256sum
 * - macOS: find + shasum -a 256
 * 
 * @example
 * ```typescript
 * import { scanLocal, scanRemote } from '@helpers/indexing';
 * 
 * // Local scan with progress
 * const localIndex = await scanLocal('/path/to/workspace', {
 *   includeHashes: true,
 *   excludePatterns: ['.git', 'node_modules'],
 *   onProgress: ({ phase, done, total }) => {
 *     console.log(`${phase}: ${done}/${total || '?'}`);
 *   }
 * });
 * 
 * // Remote scan via SSH
 * const remoteIndex = await scanRemote(
 *   'host:22',
 *   '/remote/path',
 *   ['.git', 'node_modules'],
 *   sshClient,
 *   { includeHashes: true }
 * );
 * ```
 */

// Types
export type { 
  OS, 
  ScanOptions, 
  ScanRemoteOptions,
  ScanEntry, 
  ScanProgress, 
  ProgressPhase,
  SSHClient
} from './types';

// Main scanners
export { scanLocal } from './scanLocal';
export { 
  scanRemote, 
  clearRemoteOSCache, 
  getCachedRemoteOS,
  setRemoteOSCache 
} from './scanRemote';

// OS detection
export { detectLocalOS, detectRemoteOS } from './os';

// Pattern utilities
export { splitIgnorePatterns } from './patterns';
export type { SplitPatterns } from './patterns';

// Index building (for testing/custom use)
export { buildIndexFromEntries, mergeHashes } from './buildIndex';

// PowerShell client management (for extension lifecycle)
export { 
  getLocalPowerShellClient, 
  disposeLocalPowerShellClient 
} from './executors/LocalPowerShellClient';

// SSH execution (for custom use cases)
export {
  execSSH,
  execSSHStreaming
} from './executors/RemoteShellExecutor';