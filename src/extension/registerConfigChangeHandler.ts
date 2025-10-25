import * as vscode from 'vscode';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { findWorkspaceFolderById } from '../infrastructure/helpers/workspaceFolder';
import { WorkspaceId } from '../domain/types';

/**
 * Registers config change handler that:
 * 1. Re-validates the specific workspace config that changed (quick reachability check)
 * 2. Updates workspace list UI with validation status
 * 3. Triggers auto-refresh when config becomes valid
 * 
 * Note: Uses quick reachability test (2s) instead of full SSH auth (8s) for speed
 * Full connection test is only done when user explicitly clicks "Test Connection"
 */
export function registerConfigChangeHandler(
  config: WorkspaceConfigService,
  validator: ConfigValidator,
  workspaceListProvider: WorkspaceListProvider | undefined,
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    config.onDidChange(async (event: { workspaceId: WorkspaceId }) => {
      console.log('[ConfigChange] Config file changed for workspace:', event.workspaceId);
      
      // Clear cache for this workspace
      validator.clearCache(event.workspaceId);

      // Find the specific workspace folder that changed
      const folder = findWorkspaceFolderById(event.workspaceId);
      
      // Only validate the workspace that changed (not all workspaces!)
      const result = await validator.validate(folder, false, true); // Quick reachability check
      const tracker = validator.getTracker();
      
      // Check if this workspace should auto-refresh
      const shouldRefresh = tracker.updateAndCheckRefresh(result);
      
      // Update workspace list UI (if multi-root)
      if (workspaceListProvider) {
        workspaceListProvider.updateConfigStatus(
          result.workspaceId,
          result.hasConfig,
          result.isValid
        );
      }
      
      // Auto-refresh if config just became valid AND host is reachable
      if (shouldRefresh) {
        console.log(`[ConfigChange] Config became valid for ${result.workspaceId}, triggering auto-refresh`);
        
        Promise.resolve(vscode.commands.executeCommand('livesync.experimental.refresh', folder))
          .then(() => console.log('[ConfigChange] Auto-refresh completed'))
          .catch(err => console.error('[ConfigChange] Auto-refresh failed:', err));
      } else if (!result.isValid && result.error) {
        // Show warning if validation failed
        console.warn('[ConfigChange] Config validation failed:', result.error);
      }
    })
  );
}