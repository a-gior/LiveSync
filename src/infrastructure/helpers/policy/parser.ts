/**
 * Policy Parser - Updated with Cleaner ActionPolicy Structure
 */

import type { ActionPolicy, SyncAction, PolicyMode } from '@domain/types';

/**
 * Parse policy string to ActionPolicy
 * 
 * Accepts strings like:
 *  - "none", "off", "" → { mode: 'none', action: 'skip' }
 *  - "check" → { mode: 'check', action: 'skip' }
 *  - "upload" → { mode: 'action', action: 'upload' }
 *  - "check&upload" → { mode: 'check&action', action: 'upload' }
 *  - "delete" → { mode: 'action', action: 'delete' }
 *  - "move" → { mode: 'action', action: 'move' }
 *  - etc.
 * 
 * @param raw - Policy string from config
 * @returns Parsed policy with mode and action
 */
export function parseActionPolicy(raw: string | null | undefined): ActionPolicy {
  if (!raw) {
    return { mode: 'none', action: 'skip' };
  }

  const tokens = String(raw)
    .toLowerCase()
    .split(/[&\s]+/)
    .map(t => t.trim())
    .filter(Boolean);

  // Check for "none" or "off"
  if (tokens.includes('none') || tokens.includes('off')) {
    return { mode: 'none', action: 'skip' };
  }

  // Check for "check" flag
  const hasCheck = tokens.includes('check');

  // Determine action from tokens
  let action: SyncAction = 'skip';
  
  for (const token of tokens) {
    switch (token) {
      case 'save':
      case 'upload':
      case 'create':
        action = 'upload';
        break;
      case 'download':
      case 'open':
        action = 'download';
        break;
      case 'delete':
        action = 'delete';
        break;
      case 'move':
        action = 'move';
        break;
    }
  }

  // Handle check-only (check without action)
  if (hasCheck && action === 'skip') {
    return { mode: 'check', action: 'skip' };
  }

  // Determine mode
  let mode: PolicyMode;
  if (hasCheck) {
    mode = 'check&action';
  } else if (action === 'skip') {
    mode = 'none';
  } else {
    mode = 'action';
  }

  return { mode, action };
}