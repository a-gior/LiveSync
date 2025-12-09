import { ActionPolicy } from "../../../domain/types";
import * as vscode from 'vscode';
import type { WorkspaceId, RelPath } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { RemotePort } from '@app/ports/RemotePort';
import { absFs } from '@infra/helpers/path/PathJoin';
import { sha256OfFile } from '@infra/helpers/hash/FileHash';
import { isDownloadable, isUploadable } from '@infra/helpers/diff';
import * as fs from 'fs';

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

/**
 * Check if we should prompt the user based on the policy check.
 * Returns shouldPrompt=true only if a conflict is detected.
 */
export async function checkShouldPrompt(
  workspaceId: WorkspaceId,
  relPath: RelPath,
  hint: 'save' | 'create' | 'open' | 'delete' | 'move' | 'upload' | 'download',
  state: SyncStateManager,
  remote: RemotePort
): Promise<{ shouldPrompt: boolean; reason?: string }> {
  const localMeta = state.getLocalMeta(workspaceId, relPath);
  const remoteMeta = state.getRemoteMeta(workspaceId, relPath);

  switch (hint) {
    case 'save':
    case 'open':
    case 'upload': {
      // Check: Has the remote file been modified by someone else?
      if (!remoteMeta) {
        return { shouldPrompt: false }; // No remote file, no conflict
      }
      
      if (remoteMeta.type !== 'file' || !remoteMeta.hash) {
        return { shouldPrompt: false };
      }

      // Fetch the ACTUAL current remote hash
      let actualRemoteHash: string;
      try {
        const remoteIndex = await remote.list(workspaceId);
        const actualMeta = remoteIndex.get(relPath);
        if (!actualMeta || actualMeta.type !== 'file') {
          return { shouldPrompt: false }; // Remote file disappeared
        }
        actualRemoteHash = actualMeta.hash;
      } catch (err) {
        return { shouldPrompt: false };
      }

      // Compare: known vs actual
      const remoteWasModified = remoteMeta.hash !== actualRemoteHash;
      
      return {
        shouldPrompt: remoteWasModified,
        reason: remoteWasModified 
          ? `Remote file was modified by someone else (expected: ${remoteMeta.hash.slice(0, 8)}..., actual: ${actualRemoteHash.slice(0, 8)}...)` 
          : undefined
      };
    }

    case 'create':
    case 'move': {
      // Check: Does file already exist remotely?
      if (!remoteMeta) {
        return { shouldPrompt: false }; // Doesn't exist, OK to create
      }
      
      return {
        shouldPrompt: true,
        reason: `File already exists remotely`
      };
    }

    case 'delete': {
      // FIXED: Add comprehensive existence checks
      
      // 1. Check if file exists in our snapshot (was it ever synced?)
      if (!remoteMeta) {
        return {
          shouldPrompt: true,
          reason: `File was never synced or already deleted from remote`
        };
      }

      if (remoteMeta.type !== 'file') {
        return { shouldPrompt: false }; // Not a file, don't check
      }

      // 2. Check if file still exists remotely (did someone else delete it?)
      let actualRemoteMeta;
      try {
        const remoteIndex = await remote.list(workspaceId);
        actualRemoteMeta = remoteIndex.get(relPath);
        
        if (!actualRemoteMeta) {
          return {
            shouldPrompt: true,
            reason: `File no longer exists on remote (may have been deleted by someone else)`
          };
        }

        if (actualRemoteMeta.type !== 'file') {
          return { shouldPrompt: false }; // Type changed, handle separately
        }
      } catch (err) {
        return { shouldPrompt: false }; // Error fetching, proceed without check
      }

      // 3. Check if someone modified the remote file (existing logic)
      const remoteWasModified = remoteMeta.hash !== actualRemoteMeta.hash;
      
      return {
        shouldPrompt: remoteWasModified,
        reason: remoteWasModified 
          ? `Remote file was modified by someone else before deletion (expected: ${remoteMeta.hash.slice(0, 8)}..., actual: ${actualRemoteMeta.hash.slice(0, 8)}...)` 
          : undefined
      };
    }

    case 'download': {
      // NEW: Implement download check logic
      
      // Check if local file exists
      const absPath = absFs(workspaceId, relPath);
      let localExists = false;
      try {
        await fs.promises.access(absPath);
        localExists = true;
      } catch {
        localExists = false;
      }

      if (!localExists) {
        return { shouldPrompt: false }; // No local file, safe to download
      }

      // File exists locally - check if it has unsaved changes
      // Compare local file hash with our cached local hash
      if (localMeta && localMeta.type === 'file') {
        try {
          const actualLocalHash = await sha256OfFile(absPath);
          const hasUnsavedChanges = localMeta.hash !== actualLocalHash;
          
          if (hasUnsavedChanges) {
            return {
              shouldPrompt: true,
              reason: `Local file has unsaved changes (will be overwritten)`
            };
          }
        } catch (err) {
          // Can't read local file, proceed with basic existence warning
        }
      }

      // Local file exists but no detected changes
      return {
        shouldPrompt: true,
        reason: `Local file exists (will be overwritten)`
      };
    }

    default:
      return { shouldPrompt: false };
  }
}

/**
 * Prompt user to confirm policy action.
 * Returns 'proceed' | 'diff' | 'cancel' | 'ignore'
 */
export async function confirmPolicyAction(
  workspaceId: WorkspaceId,
  mode: 'upload' | 'download' | 'delete' | 'move',
  allowDiff: boolean,
  relPath: RelPath,
  reason?: string
): Promise<'proceed' | 'diff' | 'cancel' | 'ignore'> {
  const label =
    mode === 'upload'   ? 'Upload' :
    mode === 'download' ? 'Download' :
    mode === 'delete'   ? 'Delete from Remote' : 'Move on Remote';

  const reasonText = reason ? `\n\n${reason}` : '';
  const message = `LiveSync: ${label} "${(relPath as string) || '.'}"?${reasonText}`;
  
  // Build buttons array: always include Proceed and Ignore
  const buttons = allowDiff 
    ? (['Proceed', 'Show Diff', 'Ignore'] as const)
    : (['Proceed', 'Ignore'] as const);

  const choice = await vscode.window.showWarningMessage(
    message, 
    { modal: true }, 
    ...buttons
  );

  if (choice === 'Proceed') {
    return 'proceed';
  }
  
  if (choice === 'Show Diff' && allowDiff) {
    await vscode.commands.executeCommand('livesync.experimental.node.showDiff', {
      kind: 'entry',
      workspaceId,
      path: relPath,
    });
    return 'diff';
  }

  if (choice === 'Ignore') {
    return 'ignore';
  }
  
  return 'cancel';
}

/**
 * Show informational message for check-only policies.
 */
export async function showCheckInfo(
  hint: 'save' | 'create' | 'open' | 'rename' | 'delete',
  relPath: RelPath,
  oldPath?: RelPath
): Promise<void> {
  const verb =
    hint === 'save'   ? 'Saved' :
    hint === 'create' ? 'Created' :
    hint === 'open'   ? 'Opened' :
    hint === 'rename' ? 'Renamed' : 'Deleted';

  const display = oldPath ? `${oldPath} → ${relPath}` : relPath;

  const message = `LiveSync (check): ${verb} "${display}". No sync action taken (policy = check).`;
  await vscode.window.showInformationMessage(message);
}

/**
 * Execute policy-based action (upload or download).
 * This is the main entry point for policy-driven file operations.
 * 
 * @param mode - 'file' for single file operations, 'folder' for batch operations
 * @param files - Only used when mode='folder'. Array of files to process.
 */
export async function maybeActByPolicy(
  workspaceId: WorkspaceId,
  relPath: RelPath,
  policy: ReturnType<typeof parseActionPolicy>,
  hint: 'save' | 'create' | 'open' | 'delete' | 'move' | 'upload' | 'download',
  state: SyncStateManager,
  remote: RemotePort,
  mode: 'file' | 'folder' = 'file',
  files?: Array<{ relPath: RelPath; absLocal: string }>
): Promise<void> {
  // No direction and no extras → nothing to do
  if (!policy.direction && policy.extras.size === 0) {
    if (policy.check) {
      // Check-only: show info if check is negative
      const { shouldPrompt, reason } = await checkShouldPrompt(workspaceId, relPath, hint, state, remote);
      if (shouldPrompt) {
        await vscode.window.showInformationMessage(
          `LiveSync (check): ${reason || 'Check failed'} for "${relPath as string}". No sync action taken.`
        );
      }
    }
    return;
  }

  // Has a direction (upload/download) or extras (delete/rename)
  if (policy.direction) {
    const entry = state.getDiffEntry(workspaceId, relPath);
    const allowed = policy.direction === 'upload'
      ? (entry ? isUploadable(entry.status) : true)
      : (entry ? isDownloadable(entry.status) : true);

    if (!allowed) {
      return; // Status doesn't allow this action
    }

    // If check is enabled, verify condition (only for file mode)
    if (policy.check && mode === 'file') {
      const { shouldPrompt, reason } = await checkShouldPrompt(
        workspaceId, 
        relPath, 
        policy.direction === 'upload' ? hint : 'download',
        state,
        remote
      );
      
      if (shouldPrompt) {
        // Prompt user to confirm action
        const decision = await confirmPolicyAction(
          workspaceId, 
          policy.direction, 
          policy.direction === 'upload' && (hint === 'save' || hint === 'create'), // allowDiff
          relPath,
          reason
        );
        if (decision !== 'proceed') {
          return; // User cancelled
        }
      }
      // If check passed (shouldPrompt = false), proceed silently
    }

    // Perform the action
    if (mode === 'file') {
      // Single file operation
      if (policy.direction === 'upload') {
        const abs = absFs(workspaceId, relPath);
        await remote.uploadFile(workspaceId, relPath, abs);
        const h = await sha256OfFile(abs).catch(() => undefined);
        if (h) {
          state.applyRemote({
            workspaceId,
            type: 'modify',
            path: relPath,
            meta: { type: 'file', hash: h }
          });
        }
      } else {
        const abs = absFs(workspaceId, relPath);
        await remote.downloadFile(workspaceId, relPath, abs);
        const h = await sha256OfFile(abs).catch(() => undefined);
        if (h) {
          state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash: h } });
        }
      }
    } else {
      // Folder (batch) operation
      if (!files || files.length === 0) {
        return;
      }

      if (policy.direction === 'upload') {
        const uploaded = await remote.uploadFolder(workspaceId, files);
        // Update remote snapshot for uploaded files
        for (const rel of uploaded) {
          const abs = absFs(workspaceId, rel);
          const h = await sha256OfFile(abs).catch(() => undefined);
          if (h) {
            state.applyRemote({
              workspaceId,
              type: 'modify',
              path: rel,
              meta: { type: 'file', hash: h }
            });
          }
        }
      } else {
        const downloaded = await remote.downloadFolder(workspaceId, files);
        // Update local snapshot for downloaded files
        for (const rel of downloaded) {
          const abs = absFs(workspaceId, rel);
          const h = await sha256OfFile(abs).catch(() => undefined);
          if (h) {
            state.applyLocal({ workspaceId, type: 'modify', path: rel, meta: { type: 'file', hash: h } });
          }
        }
      }
    }
  }

  // Extras are handled in specific event handlers (delete/rename)
}