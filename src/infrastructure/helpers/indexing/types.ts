/**
 * OS-native index scanning types
 */

import type { Client as SSHClient } from 'ssh2';

export type OS = 'linux' | 'darwin' | 'windows';

export type ProgressPhase = 'scan' | 'hash';

export interface ScanProgress {
  phase: ProgressPhase;
  done: number;
  total: number;  // 0 if unknown
}

export interface ScanOptions {
  includeHashes: boolean;
  excludePatterns?: string[];
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

export interface ScanRemoteOptions {
  includeHashes: boolean;
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

export interface ScanEntry {
  relPath: string;      // Forward slashes, no leading slash
  type: 'f' | 'd';
  size: number;         // 0 for dirs
  mtimeMs: number;      // Unix ms
  hash: string;         // Empty if dir or includeHashes=false
}

/** Re-export SSH client type for convenience */
export type { SSHClient };