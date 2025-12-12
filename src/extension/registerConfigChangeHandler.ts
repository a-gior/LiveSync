import * as vscode from 'vscode';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { ConfigStatusBar } from '@presentation/statusbar/ConfigStatusBar';
import { findWorkspaceFolderById } from '../infrastructure/helpers/workspaceFolder';
import { WorkspaceId } from '../domain/types';

/**
 * Registers config change handler that:
 * 1. Re-validates the specific workspace config that changed
 * 2. Updates workspace list UI with validation status (multi-root)
 * 3. Updates config status bar (both single and multi-root)
 * 4. Triggers auto-refresh when config becomes valid
 */
export function registerConfigChangeHandler(
  config: WorkspaceConfigService,
  validator: ConfigValidator,
  workspaceListProvider: WorkspaceListProvider | undefined,
  configStatusBar: ConfigStatusBar,
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    config.onConfigChange(async (event: { workspaceId: WorkspaceId }) => {
      console.log('[ConfigChange] Config file changed for workspace:', event.workspaceId);
      
      validator.clearCache(event.workspaceId);

      const folder = findWorkspaceFolderById(event.workspaceId);
      const result = await validator.validate(folder, false, true);
      const tracker = validator.getTracker();
      
      const shouldRefresh = tracker.updateAndCheckRefresh(result);
      
      // Update workspace list UI (multi-root)
      if (workspaceListProvider) {
        workspaceListProvider.updateConfigStatus(
          result.workspaceId,
          result.hasConfig,
          result.isValid
        );
      }

      // Update config status bar (both single and multi-root)
      await updateConfigStatusForWorkspace(configStatusBar, config, folder, result);
      
      // Auto-refresh if config just became valid
      if (shouldRefresh) {
        console.log(`[ConfigChange] Config became valid for ${result.workspaceId}, triggering auto-refresh`);
        
        Promise.resolve(vscode.commands.executeCommand('livesync.experimental.refresh', folder))
          .then(() => console.log('[ConfigChange] Auto-refresh completed'))
          .catch(err => console.error('[ConfigChange] Auto-refresh failed:', err));
      } else if (!result.isValid && result.error) {
        console.warn('[ConfigChange] Config validation failed:', result.error);
      }
    })
  );
}

/**
 * Helper: Update config status bar for a specific workspace
 */
async function updateConfigStatusForWorkspace(
  configStatusBar: ConfigStatusBar,
  config: WorkspaceConfigService,
  folder: vscode.WorkspaceFolder,
  result: ReturnType<typeof ConfigValidator.prototype.getCached>
): Promise<void> {
  // Get config details if valid
  let hostname: string | undefined;
  let remotePath: string | undefined;
  
  if (result.isValid) {
    try {
      const cfg = await config.get(folder);
      hostname = cfg.data.hostname;
      remotePath = cfg.data.remotePath;
    } catch {
      // Ignore - will show as configured without details
    }
  }

  configStatusBar.updateWorkspaceStatus(
    result.workspaceId,
    result,
    hostname,
    remotePath,
    folder.name
  );
}