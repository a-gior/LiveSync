import { ActionPolicy } from "@domain/types";
  
/**
 * Accepts strings like:
 *  - "check"
 *  - "save", "upload", "create"
 *  - "download"
 *  - "delete", "check&delete"
 *  - "move", "move", "check&move"
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
 *      extras:      "delete", "move"/"move"
 */
export function parseActionPolicy(raw: string | null | undefined): ActionPolicy {
  const policy: ActionPolicy = {
    check: false,
    direction: undefined,
    extras: new Set(),
  };

  if (!raw) {return policy;}

  const tokens = String(raw)
    .toLowerCase()
    .split(/[&\s]+/)
    .map(t => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === 'check') {
      policy.check = true;
    } else if (token === 'none' || token === 'off') {
      return { check: false, direction: undefined, extras: new Set() };
    } else if (token === 'save' || token === 'upload' || token === 'create') {
      policy.direction = 'upload';
    } else if (token === 'download') {
      policy.direction = 'download';
    } else if (token === 'delete') {
      policy.extras.add('delete');
    } else if (token === 'move' || token === 'move') {
      policy.extras.add('move');
    }
  }

  return policy;
}