/**
 * Local filesystem scanner using OS-native commands
 * 
 * Uses PowerShell on Windows, bash+find on Linux/macOS.
 * Three-phase scanning: count → scan → hash
 * Streams output for real-time progress reporting.
 */

import { detectLocalOS } from './os';
import { splitIgnorePatterns } from './patterns';
import { buildLinuxCommands } from './commands/linux';
import { buildDarwinCommands } from './commands/darwin';
import { buildWindowsCountCommand, buildWindowsScanCommand } from './commands/windows';
import { parseLine, parseHashLine } from './parsers';
import { buildIndexFromEntries, mergeHashes } from './buildIndex';
import { execBash, execBashStreaming } from './executors/LocalShellExecutor';
import { getLocalPowerShellClient } from './executors/LocalPowerShellClient';
import type { ScanOptions, ScanEntry } from './types';
import type { NodeIndex } from '@domain/types';

// Progress report interval
const PROGRESS_INTERVAL = 100;

/**
 * Scan local filesystem and build index
 * 
 * @param rootPath - Absolute path to scan
 * @param options - Scan options including progress callback
 * @returns NodeIndex map of RelPath -> NodeMeta
 */
export async function scanLocal(
  rootPath: string,
  options: ScanOptions
): Promise<NodeIndex> {
  const os = detectLocalOS();
  const { prunable, postFilter } = splitIgnorePatterns(options.excludePatterns ?? []);

  let entries: ScanEntry[];

  if (os === 'windows') {
    entries = await scanLocalWindows(rootPath, prunable, postFilter, options);
  } else {
    entries = await scanLocalUnix(rootPath, prunable, postFilter, options, os);
  }

  return buildIndexFromEntries(entries);
}

/**
 * Windows scanning via persistent PowerShell process
 * Three phases: count → scan with hash (inline)
 */
async function scanLocalWindows(
  root: string,
  prunable: string[],
  postFilter: string[],
  options: ScanOptions
): Promise<ScanEntry[]> {
  const client = getLocalPowerShellClient();

  // Phase 0: Count entries
  const countScript = buildWindowsCountCommand(root, prunable);
  const countResult = await client.exec(countScript);
  const total = parseInt(countResult.trim(), 10) || 0;

  options.onProgress?.({ phase: 'scan', done: 0, total });

  // Phase 1+2: Scan with hashes (Windows does both inline)
  const scanScript = buildWindowsScanCommand(root, prunable, options.includeHashes);
  const entries: ScanEntry[] = [];
  let count = 0;

  for await (const line of client.execStreaming(scanScript, options.signal)) {
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

  // Final progress
  options.onProgress?.({
    phase: options.includeHashes ? 'hash' : 'scan',
    done: entries.length,
    total: entries.length
  });

  return entries;
}

/**
 * Linux/macOS scanning via bash + find
 * Three phases: count → scan → hash
 */
async function scanLocalUnix(
  root: string,
  prunable: string[],
  postFilter: string[],
  options: ScanOptions,
  os: 'linux' | 'darwin'
): Promise<ScanEntry[]> {
  const builder = os === 'darwin' ? buildDarwinCommands : buildLinuxCommands;
  const { count: countCmd, metadata, hashes } = builder(root, prunable, options.includeHashes);

  // Phase 0: Count entries (fast)
  const countResult = await execBash(countCmd);
  const total = parseInt(countResult.trim(), 10) || 0;

  options.onProgress?.({ phase: 'scan', done: 0, total });

  // Phase 1: Stream metadata
  const entries: ScanEntry[] = [];
  let scanCount = 0;

  for await (const line of execBashStreaming(metadata, options.signal)) {
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

    for await (const line of execBashStreaming(hashes, options.signal)) {
      if (options.signal?.aborted) {break;}

      const parsed = parseHashLine(line, root);
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