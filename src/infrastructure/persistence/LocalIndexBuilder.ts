import * as vscode from 'vscode';
import * as path from 'path';
import { sha1OfFile } from '@infra/files/FileHash';
import { FileMeta } from '@domain/types';

export type BuildIndexOptions = {
  excludeGlobs?: string[];          // extra excludes from settings
  concurrency?: number;             // default 4
  progress?: (done: number, total: number) => void;
  token?: vscode.CancellationToken; // allow cancellation
};

/**
 * Build a hash-only local index for a workspace folder.
 * - Files => { type:'file', hash }
 * - Folders are inferred from paths.
 * - Runs with limited concurrency, progress, and cancellation.
 */
export async function buildLocalIndex(
  workspace: vscode.WorkspaceFolder,
  options: BuildIndexOptions = {}
): Promise<Map<string, FileMeta>> {
  const index = new Map<string, FileMeta>();
  const concurrency = Math.max(1, options.concurrency ?? 4);

  // sensible defaults; you can extend via settings later
  const defaultExcludes = [
    '**/.git/**',
    '**/.svn/**',
    '**/node_modules/**',
    '**/.vscode/**',
    '**/.idea/**',
    '**/dist/**',
    '**/build/**',
    '**/.cache/**',
    '**/.next/**',
    '**/coverage/**'
  ];
  const excludeGlobs = mergeExcludeGlobs(defaultExcludes, options.excludeGlobs ?? []);

  // List files first
  const includeGlob = new vscode.RelativePattern(workspace, '**/*');
  const fileUris = await vscode.workspace.findFiles(includeGlob, excludeGlobs);

  // Filter out directories defensively (findFiles returns files, but double check)
  const filePaths: string[] = [];
  for (const uri of fileUris) {
    if (options.token?.isCancellationRequested) {
      return index;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.Directory) === 0) {
        filePaths.push(uri.fsPath);
      }
    } catch {
      // ignore files that disappeared
    }
  }

  const totalCount = filePaths.length;
  let doneCount = 0;

  // Concurrency pool
  const queue = filePaths.slice(); // clone
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
            const hash = await sha1OfFile(fsPath);
            index.set(rel, { type: 'file', hash });
          } catch {
            // ignore unreadable files
          } finally {
            doneCount += 1;
            options.progress?.(doneCount, totalCount);
            // yield to keep extension host responsive
            await new Promise((r) => setImmediate(r));
          }
        }
      })()
    );
  }

  await Promise.all(workers);
  return index;
}

function mergeExcludeGlobs(defaults: string[], extras: string[]): string {
  // vscode.workspace.findFiles takes a single pattern string for excludes.
  // We can join multiple with brace expansion: {a,b,c}
  const all = [...defaults, ...extras];
  const cleaned = all.map((g) => g.replace(/^\s+|\s+$/g, '')).filter(Boolean);
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
