/**
 * macOS (Darwin) command builder
 * 
 * Uses find + shasum -a 256 (BSD variants)
 * Note: BSD find doesn't have -printf, so we use a different approach
 */

import { escapeForShell } from '../patterns';
import type { CommandSet } from './linux';

/**
 * Build macOS commands for filesystem scanning
 * 
 * @param root - Absolute path to scan
 * @param excludeNames - Simple names to prune
 * @param includeHashes - Whether to compute file hashes
 */
export function buildDarwinCommands(
  root: string,
  excludeNames: string[],
  includeHashes: boolean
): CommandSet {
  const escapedRoot = escapeForShell(root);
  const pruneClause = buildPruneClause(excludeNames);
  
  // Count command
  const count = `find '${escapedRoot}' ${pruneClause}\\( -type f -o -type d \\) 2>/dev/null | wc -l`;
  
  // BSD find doesn't have -printf, use -exec with stat
  // stat -f format: %N=name, %HT=type (dir/file), %z=size, %m=mtime
  // We use perl for more reliable output formatting
  const metadata = `find '${escapedRoot}' ${pruneClause}\\( -type f -o -type d \\) -print0 2>/dev/null | xargs -0 perl -e '
    use POSIX;
    for my $f (@ARGV) {
      my @s = stat($f);
      next unless @s;
      my $rel = $f;
      $rel =~ s|^\\Q${escapedRoot}\\E/?||;
      next if $rel eq "";
      my $type = -d $f ? "d" : "f";
      my $size = -d $f ? 0 : $s[7];
      my $mtime = $s[9];
      print "$rel|$type|$size|$mtime|\\n";
    }
  ' 2>/dev/null || true`;
  
  if (!includeHashes) {
    return { count, metadata };
  }
  
  // macOS uses shasum -a 256 instead of sha256sum
  const hashes = `find '${escapedRoot}' ${pruneClause}-type f -print0 2>/dev/null | xargs -0 shasum -a 256 2>/dev/null || true`;
  
  return { count, metadata, hashes };
}

function buildPruneClause(excludeNames: string[]): string {
  if (excludeNames.length === 0) {
    return '';
  }
  
  if (excludeNames.length === 1) {
    return `-name '${escapeForShell(excludeNames[0])}' -prune -o `;
  }
  
  const nameTests = excludeNames
    .map(name => `-name '${escapeForShell(name)}'`)
    .join(' -o ');
  
  return `\\( ${nameTests} \\) -prune -o `;
}