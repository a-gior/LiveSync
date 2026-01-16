/**
 * Parsers for OS command output
 * 
 * All commands produce pipe-delimited format:
 * relPath|type|size|mtimeMs|hash
 */

import { Minimatch } from 'minimatch';
import type { ScanEntry } from './types';

// Cache compiled patterns for performance
const patternCache = new Map<string, Minimatch>();

function getPattern(pattern: string): Minimatch {
  let mm = patternCache.get(pattern);
  if (!mm) {
    mm = new Minimatch(pattern, { dot: true, nocase: true });
    patternCache.set(pattern, mm);
  }
  return mm;
}

/**
 * Check if a path matches any post-filter pattern
 */
export function matchesPostFilter(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (getPattern(pattern).match(relPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a single line of metadata output
 * Returns null if line is invalid or should be filtered
 * 
 * Expected format: relPath|type|size|mtime|hash
 */
export function parseLine(
  line: string,
  postFilterPatterns: string[]
): ScanEntry | null {
  if (!line || !line.trim()) {return null;}

  const parts = line.split('|');
  if (parts.length < 4) {return null;}

  const [relPath, type, sizeStr, mtimeStr, hash = ''] = parts;
  
  // Skip empty relPath (root entry)
  if (!relPath) {return null;}

  // Normalize Windows paths to forward slashes
  const normalized = relPath.replace(/\\/g, '/');

  // Apply post-filter patterns
  if (matchesPostFilter(normalized, postFilterPatterns)) {
    return null;
  }

  // Parse mtime - could be seconds (with decimal) or milliseconds
  let mtimeMs: number;
  const mtimeFloat = parseFloat(mtimeStr);
  if (mtimeStr.includes('.') || mtimeFloat < 1e12) {
    // Seconds with decimal or clearly seconds
    mtimeMs = Math.floor(mtimeFloat * 1000);
  } else {
    // Already milliseconds
    mtimeMs = mtimeFloat;
  }

  return {
    relPath: normalized,
    type: type === 'd' ? 'd' : 'f',
    size: parseInt(sizeStr, 10) || 0,
    mtimeMs,
    hash: hash?.toLowerCase() || ''
  };
}

/**
 * Parse a single line of hash output (Linux/macOS sha256sum format)
 * 
 * Expected format: "hash  /full/path" or "hash /full/path"
 */
export function parseHashLine(
  line: string,
  rootPath: string
): { relPath: string; hash: string } | null {
  if (!line || !line.trim()) {return null;}

  // sha256sum output: "hash  filepath" (two spaces) or "hash filepath"
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
  if (!match) {return null;}

  const [, hash, fullPath] = match;
  
  // Normalize paths
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedPath = fullPath.replace(/\\/g, '/');
  
  // Extract relative path
  const prefix = normalizedRoot + '/';
  if (!normalizedPath.startsWith(prefix)) {return null;}

  return {
    relPath: normalizedPath.slice(prefix.length),
    hash: hash.toLowerCase()
  };
}