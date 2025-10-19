import { ActionPolicy } from "../../../domain/types";

/**
 * Accepts strings like:
 *  - "check"
 *  - "save", "upload", "create"
 *  - "download"
 *  - "delete", "check&delete"
 *  - "move", "rename", "check&move"
 *  - "check&save", "check&upload", "check&download"
 *  - "none", "", undefined
 *
 * Rules:
 *  - "check" alone => info popup only, no action.
 *  - "check&<action>" => confirmation popup + perform action on Proceed.
 *  - <action> without check => perform action directly.
 *  - Actions:
 *      upload-dir:  "save" | "upload" | "create"
 *      download-dir:"download"
 *      extras:      "delete", "move"/"rename"
 */
export function parseActionPolicy(input?: string | null): ActionPolicy {
  const policy: ActionPolicy = { check: false, direction: undefined, extras: new Set() };

  if (!input) {
    return policy;
  }
  const raw = String(input).trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'off') {
    return policy;
  }

  // Split by & and whitespace, ignore empties
  const tokens = raw
    .split('&')
    .flatMap((t) => t.split(/\s+/))
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === 'check') {
      policy.check = true;
      continue;
    }
    // upload-ish synonyms
    if (token === 'save' || token === 'upload' || token === 'create') {
      policy.direction = 'upload';
      continue;
    }
    // download-ish synonyms
    if (token === 'download' || token === 'pull' || token === 'get') {
      policy.direction = 'download';
      continue;
    }
    // destructive / structural extras
    if (token === 'delete' || token === 'remove' || token === 'rm') {
      policy.extras.add('delete');
      continue;
    }
    if (token === 'move' || token === 'rename' || token === 'mv') {
      policy.extras.add('rename');
      continue;
    }
    // Unknown tokens are ignored on purpose (for forward-compat)
  }

  return policy;
}
