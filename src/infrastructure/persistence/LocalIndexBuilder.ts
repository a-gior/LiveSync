import * as vscode from 'vscode';
import * as path from 'path';
import fg, { Entry } from 'fast-glob';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { computeAllFolderHashes } from '@helpers/hash/FolderHash';
import { FileMeta, FolderMeta, NodeMeta, RelPath } from '@domain/types';
import { stringToRel, relFromAbs } from '@helpers/path';
import { IgnoreFilter } from '@helpers/ignore';

export type BuildIndexOptions = {
  excludeGlobs?: readonly string[];
  concurrency?: number;
  progress?: (done: number, total: number) => void;
  token?: vscode.CancellationToken;
};

/**
 * Build a complete local index for a workspace folder using fast-glob.
 * - Files => { type:'file', hash: sha256 }
 * - Folders => { type:'folder', hash: computed from children }
 * - Includes empty folders
 * - Respects ignore patterns (including automatic .livesync exclusion)
 */
export async function buildLocalIndex(
  workspace: vscode.WorkspaceFolder,
  options: BuildIndexOptions = {}
): Promise<Map<RelPath, NodeMeta>> {
  const index = new Map<RelPath, NodeMeta>();
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const rootPath = workspace.uri.fsPath;

  // Create IgnoreFilter which handles pattern expansion and .livesync auto-exclusion
  const ignoreFilter = new IgnoreFilter(options.excludeGlobs ?? []);

  // Step 1: Use fast-glob to list ALL entries (files + directories) at once
  // Pass original glob patterns without transformation - fast-glob handles them correctly
  const entries: Entry[] = await fg('**/*', {
    cwd: rootPath,
    dot: true,
    stats: true,
    onlyFiles: false,
    ignore: ignoreFilter.getFastGlobPatterns(),
    suppressErrors: true,
  });

  // Step 2: Process entries into files and folders
  const filesToHash: Array<{ relPath: RelPath; absPath: string }> = [];
  const allFolders = new Set<RelPath>();

  for (const entry of entries) {
    if (options.token?.isCancellationRequested) {
      return index;
    }

    if (!entry.stats) continue;

    const absPath = path.join(rootPath, entry.path);
    
    const relPath = relFromAbs(rootPath, absPath);
    
    // Double-check ignore rules (catches anything fast-glob missed)
    if (ignoreFilter.shouldIgnore(relPath)) {
      continue;
    }

    if (entry.stats.isDirectory()) {
      allFolders.add(relPath);
    } else if (entry.stats.isFile()) {
      filesToHash.push({ relPath, absPath });
    }
  }

  // Step 3: Add parent folders of files (for intermediate folders)
  for (const file of filesToHash) {
    const parts = (file.relPath as string).split('/');
    for (let i = 1; i < parts.length; i++) {
      const folderRel = parts.slice(0, i).join('/');
      allFolders.add(stringToRel(folderRel));
    }
  }

  // Step 4: Add all folders to index (including empty ones)
  for (const folderRel of allFolders) {
    index.set(folderRel, { type: 'folder', hash: '' } as FolderMeta);
  }

  // Step 5: Hash all files with concurrency
  const totalCount = filesToHash.length;
  let doneCount = 0;
  const queue = filesToHash.slice();
  const workers: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i += 1) {
    workers.push(
      (async () => {
        while (true) {
          if (options.token?.isCancellationRequested) return;
          
          const file = queue.shift();
          if (!file) return;

          try {
            const hash = await sha256OfFile(file.absPath);
            index.set(file.relPath, { type: 'file', hash } as FileMeta);
          } catch (err) {
            // File became unreadable or was deleted during scan
          } finally {
            doneCount += 1;
            options.progress?.(doneCount, totalCount);
            await new Promise((r) => setImmediate(r));
          }
        }
      })()
    );
  }

  await Promise.all(workers);

  // Step 6: Compute folder hashes bottom-up using existing helper
  await computeAllFolderHashes(index);

  return index;
}

export function getIndexingSettings() {
  const cfg = vscode.workspace.getConfiguration('livesync');
  const userExcludes = cfg.get<string[]>('index.excludeGlobs') ?? [];
  const concurrency = cfg.get<number>('index.concurrency') ?? 4;
  return { userExcludes, concurrency };
}