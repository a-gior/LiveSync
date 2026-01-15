/**
 * Local index builder using OS-native commands
 */

import * as vscode from 'vscode';
import { scanLocal } from '@helpers/indexing';
import { IgnoreFilter } from '@helpers/ignore';
import type { NodeMeta, RelPath } from '@domain/types';

export type BuildIndexOptions = {
  excludeGlobs?: readonly string[];
  concurrency?: number;  // Kept for API compat, but not used (OS handles parallelism)
  progress?: (done: number, total: number) => void;
  token?: vscode.CancellationToken;
};

/**
 * Build a complete local index for a workspace folder.
 * 
 * Uses OS-native commands for performance:
 * - Files => { type:'file', hash: sha256 }
 * - Folders => { type:'folder', hash: computed from children }
 * - Includes empty folders
 * - Respects ignore patterns
 * 
 * @param workspace - VS Code workspace folder to scan
 * @param options - Build options
 * @returns NodeIndex map
 */
export async function buildLocalIndex(
  workspace: vscode.WorkspaceFolder,
  options: BuildIndexOptions = {}
): Promise<Map<RelPath, NodeMeta>> {
  const rootPath = workspace.uri.fsPath;
  
  // Create IgnoreFilter to get expanded patterns
  const ignoreFilter = new IgnoreFilter(options.excludeGlobs ?? []);
  
  // Convert cancellation token to abort signal
  const abortController = new AbortController();
  const tokenListener = options.token?.onCancellationRequested(() => {
    abortController.abort();
  });

  try {
    const index = await scanLocal(rootPath, {
      includeHashes: true,
      excludePatterns: [...ignoreFilter.globs],
      signal: abortController.signal,
      onProgress: (progress) => {
        // Map to existing progress callback signature
        if (options.progress) {
          options.progress(progress.done, progress.total || progress.done);
        }
      }
    });

    return index;
  } finally {
    tokenListener?.dispose();
  }
}