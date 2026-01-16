/**
 * Linux command builder for find + sha256sum
 */

import { escapeForShell } from '../patterns';

export interface CommandSet {
  /** Command to count entries (fast) */
  count: string;
  /** Command to get file/folder metadata */
  metadata: string;
  /** Command to get file hashes (undefined if includeHashes=false) */
  hashes?: string;
}

/**
 * Build Linux commands for filesystem scanning
 * 
 * @param root - Absolute path to scan
 * @param excludeNames - Simple names to prune (e.g., ".git", "node_modules")
 * @param includeHashes - Whether to compute file hashes
 */
export function buildLinuxCommands(
  root: string,
  excludeNames: string[],
  includeHashes: boolean
): CommandSet {
  const escapedRoot = escapeForShell(root);
  const pruneClause = buildPruneClause(excludeNames);
  
  // Count command: fast count of files + dirs
  const count = `find '${escapedRoot}' ${pruneClause}\\( -type f -o -type d \\) 2>/dev/null | wc -l`;
  
  // Metadata command outputs: relPath|type|size|mtime
  // %P = path relative to starting point
  // %y = file type (f=file, d=directory)
  // %s = size in bytes
  // %T@ = modification time as seconds.fraction since epoch
  const metadata = `find '${escapedRoot}' ${pruneClause}-printf '%P|%y|%s|%T@|\\n' 2>/dev/null || true`;
  
  if (!includeHashes) {
    return { count, metadata };
  }
  
  // Hash command: parallel sha256sum
  // -print0 + xargs -0 handles filenames with spaces/special chars
  // -P4 runs 4 parallel processes
  // -r skips if no files (GNU xargs)
  const hashes = `find '${escapedRoot}' ${pruneClause}-type f -print0 2>/dev/null | xargs -0 -r -P4 sha256sum 2>/dev/null || true`;
  
  return { count, metadata, hashes };
}

/**
 * Build find's prune clause from exclude names
 */
function buildPruneClause(excludeNames: string[]): string {
  if (excludeNames.length === 0) {
    return '';
  }
  
  if (excludeNames.length === 1) {
    return `-name '${escapeForShell(excludeNames[0])}' -prune -o `;
  }
  
  // Multiple names: \( -name 'a' -o -name 'b' \) -prune -o
  const nameTests = excludeNames
    .map(name => `-name '${escapeForShell(name)}'`)
    .join(' -o ');
  
  return `\\( ${nameTests} \\) -prune -o `;
}