/**
 * Ignore pattern utilities
 * 
 * Splits patterns into:
 * - Prunable: Simple names/wildcards that can skip entire directories
 * - Post-filter: Complex patterns that need matching after scan
 */

export interface SplitPatterns {
  /** Simple names/wildcards - can prune entire directories in command */
  prunable: string[];
  /** Complex patterns - filter after parsing output */
  postFilter: string[];
}

/**
 * Split ignore patterns into prunable (command-level) and post-filter groups
 * 
 * Prunable patterns are simple enough to be handled by find/PowerShell:
 * - Simple names: ".git", "node_modules"
 * - Simple wildcards: "*.log", ".env*"
 * 
 * Post-filter patterns are too complex:
 * - Path patterns: "**\/.cache/**", "build/output"
 * - Negations: "!important.txt"
 */
export function splitIgnorePatterns(patterns: string[]): SplitPatterns {
  const prunable: string[] = [];
  const postFilter: string[] = [];

  for (const pattern of patterns) {
    if (isPrunable(pattern)) {
      const name = extractPrunableName(pattern);
      if (name && !prunable.includes(name)) {
        prunable.push(name);
      }
    } else {
      if (!postFilter.includes(pattern)) {
        postFilter.push(pattern);
      }
    }
  }

  return { prunable, postFilter };
}

/**
 * Check if a pattern can be used for directory pruning
 */
function isPrunable(pattern: string): boolean {
  // Negations can't be pruned
  if (pattern.startsWith('!')) {
    return false;
  }

  // Path patterns can't be pruned simply
  if (pattern.includes('/')) {
    // Exception: patterns like "**/name/**" or "**/name" can extract the name
    const match = pattern.match(/^\*\*\/([^/*]+)(?:\/\*\*)?$/);
    if (match) {
      return true;
    }
    return false;
  }

  // Simple name or simple wildcard
  return true;
}

/**
 * Extract the name from a pattern for pruning
 */
function extractPrunableName(pattern: string): string | null {
  // Handle "**/name/**" or "**/name" patterns
  const doubleStarMatch = pattern.match(/^\*\*\/([^/*]+)(?:\/\*\*)?$/);
  if (doubleStarMatch) {
    return doubleStarMatch[1];
  }

  // Simple pattern without path separators
  if (!pattern.includes('/')) {
    return pattern;
  }

  return null;
}

/**
 * Escape string for shell single quotes
 */
export function escapeForShell(name: string): string {
  return name.replace(/'/g, "'\\''");
}

/**
 * Escape string for PowerShell single quotes
 */
export function escapeForPowerShell(name: string): string {
  return name.replace(/'/g, "''");
}