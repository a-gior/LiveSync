import type { RelPath } from '@domain/types';
import { relToString, stringToRel } from './PathCast';

/** Internal: normalize all slashes and collapse multiple. */
function _normSlash(s: string): string {
  return s.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/** Canonicalize a *relative* path string and brand it as RelPath. */
export function asRel(input: string): RelPath {
  // normalize slashes, strip leading "./" and "/" and trailing "/"
  let s = _normSlash(input).replace(/^\.\//, '').replace(/^\/+/, '');
  if (s !== '') {
    s = s.replace(/\/+$/, '');
  }
  return stringToRel(s);
}

/**
 * Compute a RelPath from an absolute FS path inside a workspace.
 * Returns undefined if `absFsPath` is *not* within the workspace folder.
 * If it equals the workspace folder itself, returns '' (root).
 */
export function relFromAbs(workspaceFsPath: string, absFsPath: string): RelPath {
  const root = _normSlash(workspaceFsPath).replace(/\/+$/, '');
  const abs  = _normSlash(absFsPath);
  if (abs === root) {
    return stringToRel(''); // root
  }
  if (!abs.startsWith(root + '/')) {
    throw new Error(`Path "${absFsPath}" is not under workspace root "${workspaceFsPath}".`);
  }
  return asRel(abs.slice(root.length + 1));
}

/** dirname for RelPath ('' if none). */
export function dirnameRel(p: RelPath): RelPath {
  const s = relToString(p);
  const i = s.lastIndexOf('/');
  return stringToRel(i < 0 ? '' : s.slice(0, i));
}

/** basename for RelPath (works with '' → ''). */
export function basenameRel(p: RelPath): string {
  const s = relToString(p);
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
}

/**
 * Ancestors of a RelPath, top-down (excluding the path itself).
 * 'a/b/c' → ['a', 'a/b']; '' → [].
 */
export function parentsOf(p: RelPath): RelPath[] {
  const s = p as string;
  if (!s) { return []; }
  const out: RelPath[] = [];
  const parts = s.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    out.push(stringToRel( parts.slice(0, i).join('/') ));
  }
  return out;
}

/** Returns true if candidate is exactly base or under base/<...> */
export function isUnder(base: RelPath, candidate: RelPath): boolean {
  const b = relToString(base).replace(/\/+$/, '');
  const c = relToString(candidate);
  if (b.length === 0) { return true; }
  return c === b || c.startsWith(b + '/');
}