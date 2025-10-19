import { Minimatch } from 'minimatch';

export function compile(globs: string[]): Minimatch[] {
  return globs.map((g) => new Minimatch(g, { dot: true, nocase: true, nocomment: true }));
}
export function ignored(rel: string, rules: Minimatch[]): boolean {
  const s = rel.replace(/\\/g, '/');
  return rules.some((mm) => mm.match(s));
}
