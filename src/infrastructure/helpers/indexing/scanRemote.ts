/**
 * Remote filesystem scanner using SSH commands
 * 
 * Detects remote OS and uses appropriate commands.
 * Three-phase scanning: count → scan → hash
 * Streams output for real-time progress reporting.
 */

import type { Client as SSHClient } from 'ssh2';
import { detectRemoteOS } from './os';
import { splitIgnorePatterns } from './patterns';
import { buildLinuxCommands } from './commands/linux';
import { buildDarwinCommands } from './commands/darwin';
import { buildWindowsCountCommand, buildWindowsScanCommand, escapeScriptForSSH } from './commands/windows';
import { parseLine, parseHashLine } from './parsers';
import { buildIndexFromEntries, mergeHashes } from './buildIndex';
import { execSSH, execSSHStreaming } from './executors/RemoteShellExecutor';
import type { ScanEntry, ScanRemoteOptions, OS } from './types';
import type { NodeIndex } from '@domain/types';

// Progress report interval
const PROGRESS_INTERVAL = 100;

// Cache remote OS detection per host:port
const osCache = new Map<string, OS>();

/**
 * Scan remote filesystem via SSH and build index
 * 
 * @param hostKey - Unique key for OS caching, typically "host:port"
 * @param remotePath - Absolute path on remote to scan
 * @param excludePatterns - Patterns to exclude (from ignoreList)
 * @param sshClient - SSH client instance
 * @param options - Scan options
 */
export async function scanRemote(
  hostKey: string,
  remotePath: string,
  excludePatterns: string[],
  sshClient: SSHClient,
  options: ScanRemoteOptions
): Promise<NodeIndex> {
  // Detect or retrieve cached OS
  let os = osCache.get(hostKey);
  if (!os) {
    os = await detectRemoteOS((cmd) => execSSH(sshClient, cmd));
    osCache.set(hostKey, os);
  }

  const { prunable, postFilter } = splitIgnorePatterns(excludePatterns);

  let entries: ScanEntry[];
  
  if (os === 'windows') {
    entries = await scanRemoteWindows(remotePath, prunable, postFilter, sshClient, options);
  } else {
    entries = await scanRemoteUnix(remotePath, prunable, postFilter, sshClient, options, os);
  }

  return buildIndexFromEntries(entries);
}

/**
 * Scan remote Windows server via PowerShell over SSH
 * Three phases: count → scan with hash (inline)
 */
async function scanRemoteWindows(
  remotePath: string,
  prunable: string[],
  postFilter: string[],
  sshClient: SSHClient,
  options: ScanRemoteOptions
): Promise<ScanEntry[]> {
  // Phase 0: Count entries
  const countScript = buildWindowsCountCommand(remotePath, prunable);
  const countCmd = escapeScriptForSSH(countScript);
  const countResult = await execSSH(sshClient, countCmd);
  const total = parseInt(countResult.trim(), 10) || 0;

  options.onProgress?.({ phase: 'scan', done: 0, total });

  // Phase 1+2: Scan with hashes
  const scanScript = buildWindowsScanCommand(remotePath, prunable, options.includeHashes);
  const scanCmd = escapeScriptForSSH(scanScript);

  const entries: ScanEntry[] = [];
  let count = 0;

  for await (const line of execSSHStreaming(sshClient, scanCmd, options.signal)) {
    if (options.signal?.aborted) {break;}

    const entry = parseLine(line, postFilter);
    if (entry) {
      entries.push(entry);
      count++;

      if (count % PROGRESS_INTERVAL === 0) {
        options.onProgress?.({
          phase: options.includeHashes ? 'hash' : 'scan',
          done: count,
          total
        });
      }
    }
  }

  options.onProgress?.({ 
    phase: options.includeHashes ? 'hash' : 'scan', 
    done: entries.length, 
    total: entries.length 
  });

  return entries;
}

/**
 * Scan remote Linux/macOS server via find commands
 * Three phases: count → scan → hash
 */
async function scanRemoteUnix(
  remotePath: string,
  prunable: string[],
  postFilter: string[],
  sshClient: SSHClient,
  options: ScanRemoteOptions,
  os: 'linux' | 'darwin'
): Promise<ScanEntry[]> {
  const builder = os === 'darwin' ? buildDarwinCommands : buildLinuxCommands;
  const { count: countCmd, metadata, hashes } = builder(remotePath, prunable, options.includeHashes);

  // Phase 0: Count entries (fast)
  const countResult = await execSSH(sshClient, countCmd);
  const total = parseInt(countResult.trim(), 10) || 0;

  options.onProgress?.({ phase: 'scan', done: 0, total });

  // Phase 1: Stream metadata
  const entries: ScanEntry[] = [];
  let scanCount = 0;

  for await (const line of execSSHStreaming(sshClient, metadata, options.signal)) {
    if (options.signal?.aborted) {break;}

    const entry = parseLine(line, postFilter);
    if (entry) {
      entries.push(entry);
      scanCount++;

      if (scanCount % PROGRESS_INTERVAL === 0) {
        options.onProgress?.({
          phase: 'scan',
          done: scanCount,
          total
        });
      }
    }
  }

  options.onProgress?.({ 
    phase: 'scan', 
    done: entries.length, 
    total: entries.length 
  });

  // Phase 2: Stream hashes
  if (hashes && options.includeHashes) {
    const fileCount = entries.filter(e => e.type === 'f').length;
    const hashMap = new Map<string, string>();
    let hashCount = 0;

    options.onProgress?.({ phase: 'hash', done: 0, total: fileCount });

    for await (const line of execSSHStreaming(sshClient, hashes, options.signal)) {
      if (options.signal?.aborted) {break;}

      const parsed = parseHashLine(line, remotePath);
      if (parsed) {
        hashMap.set(parsed.relPath, parsed.hash);
        hashCount++;

        if (hashCount % PROGRESS_INTERVAL === 0) {
          options.onProgress?.({
            phase: 'hash',
            done: hashCount,
            total: fileCount
          });
        }
      }
    }

    // Merge hashes into entries
    mergeHashes(entries, hashMap);

    options.onProgress?.({ 
      phase: 'hash', 
      done: fileCount, 
      total: fileCount 
    });
  }

  return entries;
}

/**
 * Clear cached remote OS
 */
export function clearRemoteOSCache(hostKey?: string): void {
  if (hostKey) {
    osCache.delete(hostKey);
  } else {
    osCache.clear();
  }
}

/**
 * Get cached remote OS (for debugging/display)
 */
export function getCachedRemoteOS(hostKey: string): OS | undefined {
  return osCache.get(hostKey);
}

/**
 * Set remote OS cache (useful when OS is known from config)
 */
export function setRemoteOSCache(hostKey: string, os: OS): void {
  osCache.set(hostKey, os);
}