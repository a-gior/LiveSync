import type { DiffStatus } from '../../domain/types';

export type DiffSide = 'remote' | 'local' | 'empty';

export function computeDiffSides(status: DiffStatus): { left: DiffSide; right: DiffSide } {
  if (status === 'added') {
    return { left: 'empty', right: 'local' };
  }
  if (status === 'removed') {
    return { left: 'remote', right: 'empty' };
  }
  // modified / conflict / unchanged (unchanged won't be diffed, but keep mapping consistent)
  return { left: 'remote', right: 'local' };
}
