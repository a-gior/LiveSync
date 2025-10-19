import * as vscode from 'vscode';
import * as path from 'path';
import { sha256OfFile } from '@helpers/hash/FileHash';
import { FileMeta, FolderMeta, NodeMeta } from '@domain/types';

export type BuildIndexOptions = {
  excludeGlobs?: string[];          // extra excludes from settings
  concurrency?: number;             // default 4
  progress?: (done: number, total: number) => void;
  token?: vscode.CancellationToken; // allow cancellation
};

/**
 * Build a complete local index for a workspace folder.
 * - Files => { type:'file', hash }
 * - Folders => { type:'folder', hash:'' } (including empty folders)
 */
export async function buildLocalIndex(
  workspace: vscode.WorkspaceFolder,
  options: BuildIndexOptions = {}
): Promise<Map<string, NodeMeta>> {
  const index = new Map<string, NodeMeta>();
  const concurrency = Math.max(1, options.concurrency ?? 4);

  const excludeGlobs = mergeExcludeGlobs(options.excludeGlobs ?? []);

  // List all items (files + directories)
  const includeGlob = new vscode.RelativePattern(workspace, '**/*');
  const allUris = await vscode.workspace.findFiles(includeGlob, excludeGlobs);

  // Separate files and folders
  const filePaths: string[] = [];
  const folderPaths = new Set<string>(); // Use Set to deduplicate

  for (const uri of allUris) {
    if (options.token?.isCancellationRequested) {
      return index;
    }
    
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const relPath = toRelativeFsPath(workspace, uri.fsPath);

      if ((stat.type & vscode.FileType.Directory) !== 0) {
        // It's a directory
        folderPaths.add(relPath);
        
        // Also add all parent directories
        const parts = relPath.split('/').filter(Boolean);
        for (let i = 1; i < parts.length; i++) {
          folderPaths.add(parts.slice(0, i).join('/'));
        }
      } else {
        // It's a file
        filePaths.push(uri.fsPath);
        
        // Add all parent directories of this file
        const parts = relPath.split('/').filter(Boolean);
        for (let i = 1; i < parts.length; i++) {
          folderPaths.add(parts.slice(0, i).join('/'));
        }
      }
    } catch (err) {
      // ignore items that disappeared
    }
  }

  // Add all folders to index first (so empty folders appear)
  for (const folderRel of folderPaths) {
    index.set(folderRel, { type: 'folder', hash: '' } as FolderMeta);
  }

  const totalCount = filePaths.length;
  let doneCount = 0;

  // Hash files with concurrency
  const queue = filePaths.slice();
  const workers: Promise<void>[] = [];
  
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(
      (async () => {
        while (true) {
          if (options.token?.isCancellationRequested) {
            return;
          }
          const fsPath = queue.shift();
          if (!fsPath) {
            return;
          }
          const rel = toRelativeFsPath(workspace, fsPath);
          try {
            const hash = await sha256OfFile(fsPath);
            index.set(rel, { type: 'file', hash } as FileMeta);
          } catch (err) {
            // ignore unreadable files
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
  return index;
}

function mergeExcludeGlobs(globs: string[]): string {
  // vscode.workspace.findFiles takes a single pattern string for excludes.
  // We can join multiple with brace expansion: {a,b,c}
  const cleaned = globs.map((g) => g.replace(/^\s+|\s+$/g, '')).filter(Boolean);
  if (cleaned.length === 0) {
    return '';
  }
  return `{${cleaned.join(',')}}`;
}

export function toRelativeFsPath(workspace: vscode.WorkspaceFolder, fsPath: string): string {
  const root = normalizeSlashes(workspace.uri.fsPath);
  const full = normalizeSlashes(fsPath);
  if (!full.startsWith(root)) {
    return full.replace(/\\/g, '/');
  }
  const trimmed = full.slice(root.length).replace(/^[/\\]/, '');
  return trimmed.replace(/\\/g, '/');
}

function normalizeSlashes(inputPath: string): string {
  return path.resolve(inputPath).replace(/\\/g, '/');
}

export function getIndexingSettings() {
  const cfg = vscode.workspace.getConfiguration('livesync');
  const userExcludes = cfg.get<string[]>('index.excludeGlobs') ?? [];
  const concurrency = cfg.get<number>('index.concurrency') ?? 4;
  return { userExcludes, concurrency };
}
