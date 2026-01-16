/**
 * Unified Action Handler
 * 
 * Central handler for all file operations (events and commands).
 * Implements the complete flow from pre-flight checks through execution.
 */

import type { WorkspaceId, RelPath, NodeMeta, ActionPolicy } from '@domain/types';
import type { SyncStateManager } from '@app/SyncStateManager';
import type { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import type { ConfigValidator } from '@infra/config/ConfigValidator';
import type { RemotePort } from '@app/ports/RemotePort';
import type { NotificationStatusBar } from '@presentation/statusbar/NotificationStatusBar';
import type { SyncStateTreeProvider } from '@presentation/tree/SyncStateTreeProvider';

import { parseActionPolicy } from '@helpers/policy/parser';
import { isNoOpPolicy, isCheckOnlyPolicy, shouldCheckConflict } from '@helpers/policy/utils';
import { detectConflict, OperationType } from '@helpers/conflict/detector';
import { resolveConflict, showCheckInfo } from '@helpers/conflict/resolver';
import { markConflictIgnored, clearIgnoredConflictIfResolved } from '@helpers/conflict/tracker';
import { executeUpload, executeDownload, executeDelete, executeRename } from './executor';
import { notifySuccess, notifyError } from '@helpers/notification';
import { LOG_FLAGS, logErrorMessage, logSync } from '@helpers/logging';
import { stringToWsId, uriFromRel } from '@helpers/path';
import { workspace } from 'vscode';
import { removeFromLocalSnapshot } from '../snapshot/update';

/**
 * Parameters for handleAction
 */
export interface HandleActionParams {
  workspaceId: WorkspaceId;
  relPath: RelPath;
  oldPath?: RelPath;          // For move operations
  policyKey: 'actionOnSave' | 'actionOnCreate' | 'actionOnDelete' | 'actionOnMove' | 'actionOnOpen' | 'actionOnUpload' | 'actionOnDownload';
  actualMetas: {
    local?: NodeMeta;         // Current filesystem state
    remote?: NodeMeta;        // Fresh remote (just fetched, NOT in snapshot yet)
  };
  isCommand: boolean;
  operation: OperationType;
  
  // Services
  state: SyncStateManager;
  config: WorkspaceConfigService;
  validator: ConfigValidator;
  remote: RemotePort;
  notifications: NotificationStatusBar;
  provider: SyncStateTreeProvider;
  shouldIgnore: (workspaceId: WorkspaceId, relPath: RelPath) => Promise<boolean>;
}

/**
 * Result of handleAction
 */
export interface HandleActionResult {
  success: boolean;
  action?: 'upload' | 'download' | 'delete' | 'move';
  skipped?: boolean;
  ignored?: boolean;
}

/**
 * Unified handler for all file operations
 * 
 * Complete flow:
 * 1. Pre-flight checks (ignored, ignore list, config, policy)
 * 2. Fetch fresh remote meta (for conflict detection)
 * 3. Detect conflict
 * 4. Handle check-only conflicts (info message)
 * 5. Resolve action conflicts (prompt user)
 * 6. Execute action
 * 7. Cleanup (clear ignored flags)
 * 
 * @param params - Operation parameters
 * @returns Result of the operation
 */
export async function handleAction(params: HandleActionParams): Promise<HandleActionResult> {
  const {
    workspaceId,
    relPath,
    oldPath,
    policyKey,
    actualMetas,
    isCommand,
    operation,
    state,
    config,
    validator,
    remote,
    notifications,
    provider,
    shouldIgnore
  } = params;
  
  // ══════════════════════════════════════════════════════════
  // 1. PRE-FLIGHT CHECKS
  // ══════════════════════════════════════════════════════════
  
  const policy = await performPreflightChecks({
    workspaceId,
    relPath,
    policyKey,
    isCommand,
    state,
    config,
    validator,
    shouldIgnore
  });
  
  if (!policy) {
    return { success: false, skipped: true };
  }
  
  // ══════════════════════════════════════════════════════════
  // 2. FETCH FRESH REMOTE META (for conflict detection only)
  // ══════════════════════════════════════════════════════════
  
  let freshRemoteMeta: NodeMeta | undefined = actualMetas.remote;
  
  // If not provided, fetch it now (only if conflict checking is needed)
  if (!freshRemoteMeta) {
    try {
      const remoteIndex = await remote.list(workspaceId);
      freshRemoteMeta = remoteIndex.get(relPath);
      if (freshRemoteMeta) {
        state.applyRemote({
          workspaceId,
          type: 'modify',
          path: relPath,
          meta: freshRemoteMeta
        });
      }
    } catch {
      // List failed - connection issue, that's ok for conflict detection
      freshRemoteMeta = undefined;
    }
  }
  
  // ══════════════════════════════════════════════════════════
  // 3. DETECT CONFLICT
  // ══════════════════════════════════════════════════════════
  
  let conflict = null;
  if (shouldCheckConflict(policy)) {
    const baseMeta = state.getBaseMeta(workspaceId, relPath);

    conflict = detectConflict({
      operation,
      workspaceId,
      relPath,
      actualMetas: {
        local: actualMetas.local,
        remote: freshRemoteMeta
      },
      baseMeta,
      state,
      isCheckOnly: isCheckOnlyPolicy(policy)
    });
  }
  
  // ══════════════════════════════════════════════════════════
  // 4. HANDLE CHECK-ONLY CONFLICT
  // ══════════════════════════════════════════════════════════
  
  if (conflict?.type.endsWith('_check')) {
    await showCheckInfo(conflict);
    return { success: false, skipped: true };
  }
  
  // ══════════════════════════════════════════════════════════
  // 5. RESOLVE ACTION CONFLICT
  // ══════════════════════════════════════════════════════════
  
  if (conflict) {
    const resolution = await resolveConflict(conflict, workspaceId, relPath);
    
    if (resolution.action === 'cancel') {
      return { success: false, skipped: true };
    }
    
    if (resolution.action === 'ignore') {
      markConflictIgnored(state, workspaceId, relPath, conflict);
      return { success: false, ignored: true };
    }
    
    // resolution.action === 'proceed' → continue to execution
  }
  
  // ══════════════════════════════════════════════════════════
  // 6. EXECUTE ACTION
  // ══════════════════════════════════════════════════════════
  
  // Get action from conflict suggestion or policy
  // With new policy structure, policy.action is always defined
  const action = conflict?.suggestedAction ?? policy.action;
  
  // Skip action - don't execute anything
  if (action === 'skip') {
    return { success: false, skipped: true };
  }
  
  try {
    logSync(stringToWsId(workspaceId), action, relPath as string, 'starting');
    
    switch (action) {
      case 'upload':
        await executeUpload(remote, state, workspaceId, relPath);
        break;
        
      case 'download':
        await executeDownload(remote, state, workspaceId, relPath);
        break;
        
      case 'delete':
        // For COMMANDS: delete both local and remote
        // For EVENTS: VS Code already deleted local, just delete remote
        
        // Delete local file
        if (actualMetas.local) {
            const uri = uriFromRel(workspaceId, relPath);
            await workspace.fs.delete(uri);
            removeFromLocalSnapshot(state, workspaceId, relPath);
        }
        
        // Delete remote file
        if (freshRemoteMeta) {
            await executeDelete(remote, state, workspaceId, relPath);
        }
        break;
        
      case 'move':
        if (!oldPath) {
          throw new Error('oldPath required for move operation');
        }

        if(conflict && conflict.type === 'file_exists_action') {
          // If target exists and conflict was detected, we need to delete it first
          await executeDelete(remote, state, workspaceId, relPath);
        }

        await executeRename(remote, state, workspaceId, oldPath, relPath);
        break;
    }
    
    logSync(stringToWsId(workspaceId), action, relPath as string, 'completed');
    notifySuccess(notifications, action, relPath);
    
  } catch (err: any) {
    // Invalidate on connection errors
    await validator.invalidate(workspaceId, err);
    
    logErrorMessage(err.message, LOG_FLAGS.ALL, `handleAction:${operation}:${relPath}`);
    notifyError(notifications, action, relPath);
    
    return { success: false };
  }
  
  // ══════════════════════════════════════════════════════════
  // 7. CLEANUP
  // ══════════════════════════════════════════════════════════
  
  provider.markRecentlyResolvedBatch(stringToWsId(workspaceId), [relPath]);
  clearIgnoredConflictIfResolved(state, workspaceId, relPath);
  
  return { success: true, action };
}

/**
 * Pre-flight checks before remote operations
 * 
 * Checks:
 * 1. Ignored files (skip for events, allow for commands)
 * 2. Ignore list patterns
 * 3. Config validity
 * 4. Policy allows action
 * 
 * @returns Policy if all checks pass, null if operation should be cancelled
 */
async function performPreflightChecks(params: {
  workspaceId: WorkspaceId;
  relPath: RelPath;
  policyKey: string;
  isCommand: boolean;
  state: SyncStateManager;
  config: WorkspaceConfigService;
  validator: ConfigValidator;
  shouldIgnore: (workspaceId: WorkspaceId, relPath: RelPath) => Promise<boolean>;
}): Promise<ActionPolicy | null> {
  const { workspaceId, relPath, policyKey, isCommand, state, config, validator, shouldIgnore } = params;
  
  // 1. Check if conflict already ignored (events only - commands override)
  if (!isCommand && state.isConflictIgnored(workspaceId, relPath)) {
    return null;
  }
  
  // 2. Check ignore patterns
  if (await shouldIgnore(workspaceId, relPath)) {
    return null;
  }
  
  // 3. Get config and parse policy
  const cfg = await config.getById(workspaceId);
  const policy = parseActionPolicy(cfg.data[policyKey as keyof typeof cfg.data] as string);
  
  // 4. No-op policy?
  if (isNoOpPolicy(policy)) {
    return null;
  }
  
  // 5. Config validity check (AFTER policy check - "none" policies don't need valid config)
  const validationResult = await validator.getCached(workspaceId);
  if (!validationResult.isValid) {
    return null;
  }
  
  return policy;
}