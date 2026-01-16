/**
 * Shared index building utilities
 * 
 * Used by both scanLocal and scanRemote to convert ScanEntry[] to NodeIndex
 */

import { computeAllFolderHashes } from '@helpers/hash';
import { stringToRel } from '@helpers/path';
import type { ScanEntry } from './types';
import type { NodeIndex, FileMeta, FolderMeta } from '@domain/types';

/**
 * Convert scan entries to NodeIndex
 * 
 * - Creates file/folder entries
 * - Adds implicit parent folders
 * - Computes folder hashes bottom-up
 */
export function buildIndexFromEntries(entries: ScanEntry[]): NodeIndex {
  const index: NodeIndex = new Map();

  // Add all entries
  for (const e of entries) {
    const rel = stringToRel(e.relPath);
    if (e.type === 'd') {
      index.set(rel, { type: 'folder', hash: '' } as FolderMeta);
    } else {
      index.set(rel, { type: 'file', hash: e.hash } as FileMeta);
    }
  }

  // Add implicit parent folders for files
  for (const e of entries) {
    if (e.type === 'f') {
      const parts = e.relPath.split('/');
      for (let i = 1; i < parts.length; i++) {
        const folderRel = stringToRel(parts.slice(0, i).join('/'));
        if (!index.has(folderRel)) {
          index.set(folderRel, { type: 'folder', hash: '' } as FolderMeta);
        }
      }
    }
  }

  // Compute folder hashes bottom-up
  computeAllFolderHashes(index);

  return index;
}

/**
 * Merge hash map into entries array
 * Modifies entries in place
 */
export function mergeHashes(entries: ScanEntry[], hashMap: Map<string, string>): void {
  for (const entry of entries) {
    if (entry.type === 'f') {
      entry.hash = hashMap.get(entry.relPath) || '';
    }
  }
}