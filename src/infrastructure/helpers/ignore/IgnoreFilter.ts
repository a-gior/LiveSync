import { Minimatch } from 'minimatch';
import type { RelPath } from '@domain/types';

/**
 * Centralized ignore pattern handling with automatic .livesync exclusion.
 * 
 * Handles pattern expansion and provides consistent filtering across:
 * - Local index building (fast-glob)
 * - Remote index building (SSH find)
 * - File event filtering
 * 
 * Pattern expansion examples:
 * - `".vscode"` becomes `["** /.vscode/** ", "** /.vscode"]` (without spaces)
 * - `"*.log"` stays as `["*.log"]` (already a glob pattern)
 * - `"node_modules"` becomes `["** /node_modules/** ", "** /node_modules"]` (without spaces)
 */
export class IgnoreFilter {
  private readonly rules: Minimatch[];
  readonly globs: readonly string[];
  
  constructor(patterns: readonly string[]) {
    // Always exclude .livesync directory to prevent infinite feedback loops
    const patternsWithLiveSync = ['.livesync', ...patterns];
    this.globs = expandToGlobs(patternsWithLiveSync);
    this.rules = compileRules(this.globs);
  }
  
  /**
   * Check if a path should be ignored
   */
  shouldIgnore(relPath: RelPath | string): boolean {
    const normalized = (relPath as string).replace(/\\/g, '/');
    return this.rules.some((mm) => mm.match(normalized));
  }
  
  /**
   * Get patterns suitable for fast-glob's ignore option.
   * Returns original glob patterns without transformation.
   */
  getFastGlobPatterns(): string[] {
    return [...this.globs];
  }
}

/**
 * Expand simple patterns to comprehensive glob patterns.
 * 
 * Simple names (no wildcards) are expanded to match anywhere in tree:
 * - `".vscode"` becomes `["** /.vscode/** ", "** /.vscode"]` (without spaces)
 * - `"node_modules"` becomes `["** /node_modules/** ", "** /node_modules"]` (without spaces)
 * 
 * Glob patterns (with *, ?, [) are used as-is:
 * - `"*.log"` stays as `["*.log"]`
 * - `"src/** "` stays as `["src/** "]` (without space)
 */
function expandToGlobs(patterns: string[]): string[] {
  const globs: string[] = [];
  
  for (const entry of patterns) {
    // Remove leading "./" or "../" or "/" or "\" but PRESERVE dots in filenames like ".vscode"
    const clean = entry.replace(/^(?:\.\.\/|\.\/|\/|\\)+/, '');
    
    // If the entry already contains glob patterns (*, ?, [), use it as-is
    if (clean.includes('*') || clean.includes('?') || clean.includes('[')) {
      globs.push(clean);
    } else {
      // Otherwise, create glob patterns to match the name anywhere in the tree
      globs.push(`**/${clean}/**`, `**/${clean}`);
    }
  }
  
  return globs;
}

/**
 * Compile glob patterns to Minimatch rules with consistent options
 */
function compileRules(globs: readonly string[]): Minimatch[] {
  return globs.map((g) => new Minimatch(g, { 
    dot: true,      // Match dot files/folders
    nocase: true,   // Case-insensitive matching
    nocomment: true // Don't treat # as comments
  }));
}