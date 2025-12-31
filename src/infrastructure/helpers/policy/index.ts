import * as vscode from 'vscode';
import type { WorkspaceId, RelPath } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { RemotePort } from '@app/ports/RemotePort';
import { absFs } from '@infra/helpers/path/PathJoin';
import { sha256OfFile } from '@infra/helpers/hash/FileHash';
import { isDownloadable, isUploadable } from '@infra/helpers/diff';
import { parseActionPolicy } from './parser';
import { getTestConflictResponse, isTestMode } from '../test';

export { parseActionPolicy } from './parser';

/**
 * Check if we should prompt the user based on snapshot comparison.
 * Returns shouldPrompt=true only if a conflict is detected.
 * 
 * IMPORTANT: This function assumes snapshots are fresh!
 * Callers MUST call ensureFreshRemoteSnapshot() or ensureFreshLocalSnapshot()
 * before calling this function to ensure accurate conflict detection.
 * 
 * Check types by hint:
 * - 'save'/'open'/'upload' → Check: Remote file different from local?
 * - 'download' → Check: Local file different from remote?
 * - 'create'/'move' → Check: File exists remotely?
 * - 'delete' → Check: File exists remotely?
 * 
 * @param workspaceId - Workspace containing the file
 * @param relPath - Relative path to check
 * @param hint - Operation type (determines what to check)
 * @param state - State manager with fresh snapshots
 * @param remote - Remote port (kept for backward compat, not used)
 */
export async function checkShouldPrompt(
  workspaceId: WorkspaceId,
  relPath: RelPath,
  hint: 'save' | 'create' | 'open' | 'delete' | 'move' | 'upload' | 'download',
  state: SyncStateManager
): Promise<{ shouldPrompt: boolean; reason?: string }> {
  const remoteMeta = state.getRemoteMeta(workspaceId, relPath);
  const localMeta = state.getLocalMeta(workspaceId, relPath);

  switch (hint) {
    case 'save':
    case 'open':
    case 'upload': {
      // Check: Has remote file been modified? (upload conflict)
      // Requires: ensureFreshRemoteSnapshot() called before this
      
      if (!remoteMeta || remoteMeta.type !== 'file') {
        return { shouldPrompt: false }; // No remote file, no conflict
      }
      
      if (!localMeta || localMeta.type !== 'file') {
        return { shouldPrompt: false }; // No local file, no conflict
      }
      
      // Compare hashes
      const remoteWasModified = remoteMeta.hash !== localMeta.hash;
      
      return {
        shouldPrompt: remoteWasModified,
        reason: remoteWasModified 
          ? `Remote file was modified by someone else (local: ${localMeta.hash.slice(0, 8)}..., remote: ${remoteMeta.hash.slice(0, 8)}...)` 
          : undefined
      };
    }

    case 'download': {
      // Check: Has local file been modified? (download conflict)
      // Requires: ensureFreshLocalSnapshot() called before this
      
      if (!localMeta || localMeta.type !== 'file') {
        return { shouldPrompt: false }; // No local file, no conflict
      }
      
      if (!remoteMeta || remoteMeta.type !== 'file') {
        return { shouldPrompt: false }; // No remote file, no conflict
      }
      
      // Compare hashes
      const localWasModified = localMeta.hash !== remoteMeta.hash;
      
      return {
        shouldPrompt: localWasModified,
        reason: localWasModified 
          ? `Local file was modified (local: ${localMeta.hash.slice(0, 8)}..., remote: ${remoteMeta.hash.slice(0, 8)}...)` 
          : undefined
      };
    }

    case 'create':
    case 'move': {
      // Check: Does file already exist remotely?
      // Requires: ensureFreshRemoteSnapshot() called before this
      
      if (remoteMeta) {
        return {
          shouldPrompt: true,
          reason: `File already exists remotely`
        };
      }
      
      return { shouldPrompt: false }; // File doesn't exist, OK to create/move
    }

    case 'delete': {
      // Check: Does file still exist remotely? Was it modified?
      // Requires: ensureFreshRemoteSnapshot() called before this
      
      if (!remoteMeta) {
        return {
          shouldPrompt: true,
          reason: `File no longer exists on remote (may have been deleted by someone else)`
        };
      }

      if (remoteMeta.type !== 'file') {
        return { shouldPrompt: false }; // Not a file, don't check
      }

      // If local snapshot shows the file existed, we can detect if remote changed
      if (localMeta && localMeta.type === 'file') {
        const remoteWasModified = remoteMeta.hash !== localMeta.hash;
        
        return {
          shouldPrompt: remoteWasModified,
          reason: remoteWasModified 
            ? `Remote file was modified by someone else before deletion` 
            : undefined
        };
      }
      
      // No local reference, can't detect modification
      return { shouldPrompt: false };
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
  reason?: string,
  allowIgnore: boolean = true
): Promise<'proceed' | 'diff' | 'cancel' | 'ignore'> {
  // Check for test mode auto-response
  if (isTestMode()) {
    const testResponse = getTestConflictResponse();
    if (testResponse) {
      console.log(`[TEST MODE] Auto-responding with: ${testResponse}`);
      return testResponse;
    }
  }
  
  const label =
    mode === 'upload'   ? 'Upload' :
    mode === 'download' ? 'Download' :
    mode === 'delete'   ? 'Delete from Remote' : 'Move on Remote';

  const reasonText = reason ? `\n\n${reason}` : '';
  const message = `LiveSync: ${label} "${(relPath as string) || '.'}"?${reasonText}`;
  
  // Build buttons array based on allowDiff and allowIgnore
  const buttons = allowIgnore
    ? (allowDiff ? (['Proceed', 'Show Diff', 'Ignore'] as const) : (['Proceed', 'Ignore'] as const))
    : (allowDiff ? (['Proceed', 'Show Diff'] as const) : (['Proceed'] as const));

  const choice = await vscode.window.showWarningMessage(
    message, 
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

  if (choice === 'Ignore' && allowIgnore) {
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
  files?: Array<{ relPath: RelPath; absLocal: string }>,
  allowIgnore: boolean = true
): Promise<void> {
  // No direction and no extras → nothing to do
  if (!policy.direction && policy.extras.size === 0) {
    if (policy.check) {
      // Check-only: show info if check is negative
      const { shouldPrompt, reason } = await checkShouldPrompt(workspaceId, relPath, hint, state);
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
      const { shouldPrompt, reason } = await checkShouldPrompt(workspaceId, relPath, hint, state);
      
      if (shouldPrompt) {
        // Prompt user to confirm action
        const decision = await confirmPolicyAction(
          workspaceId, 
          policy.direction, 
          policy.direction === 'upload' && (hint === 'save' || hint === 'create'), // allowDiff
          relPath,
          reason,
          allowIgnore // Pass through allowIgnore parameter
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