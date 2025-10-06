import { DiffStatus } from "../../domain/types";

export type Direction = 'upload' | 'download';
export type Extra = 'delete' | 'rename';

export interface ActionPolicy {
  check: boolean;                  // recompute / look at diff before acting
  direction?: Direction;           // upload (push) or download (pull)
  extras: Set<Extra>;              // delete / rename intent (delete remote, remote rename)
}

const TOKEN_MAP: Record<string, Direction | Extra | 'check'> = {
  check: 'check',
  save: 'upload', push: 'upload', upload: 'upload',
  pull: 'download', download: 'download',
  delete: 'delete', remove: 'delete',
  rename: 'rename', move: 'rename'
};

export function parseActionPolicy(raw: string | undefined): ActionPolicy {
  const policy: ActionPolicy = { check: false, direction: undefined, extras: new Set() };
  if (!raw) { return policy; }
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z]+/g)
    .filter(Boolean);

  for (const t of tokens) {
    const mapped = TOKEN_MAP[t];
    if (!mapped) { continue; }
    if (mapped === 'check') {
      policy.check = true;
    } else if (mapped === 'upload' || mapped === 'download') {
      policy.direction = mapped; // last one wins if both present
    } else {
      policy.extras.add(mapped); // delete / rename
    }
  }
  return policy;
}

// Guards based on our directional rules
export function canUpload(status: DiffStatus): boolean {
  // added & modified, plus conflict treated like modified
  return status === 'added' || status === 'modified' || status === 'conflict';
}

export function canDownload(status: DiffStatus): boolean {
  // removed & modified, plus conflict treated like modified
  return status === 'removed' || status === 'modified' || status === 'conflict';
}
