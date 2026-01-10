import * as vscode from 'vscode';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { findWorkspaceFolderById } from '@infra/helpers/workspaceFolder';
import { WorkspaceId } from '../domain/types';
import { logConfig, logErrorMessage, logOperation } from '@helpers/logging';
import { basenameRel } from '../infrastructure/helpers/path';

export function registerConfigChangeHandler(
  config: WorkspaceConfigService,
  validator: ConfigValidator,
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    config.onConfigChange(async (event: { workspaceId: WorkspaceId }) => {
      logConfig(event.workspaceId, 'configuration file changed');
      
      validator.clearCache(event.workspaceId);

      const folder = findWorkspaceFolderById(event.workspaceId);
      if(!folder) {
        logErrorMessage(`Workspace "${basenameRel(event.workspaceId)}" not found`);
        return;
      }

      const result = await validator.validate(folder, false, true);
      // ^^^^ This emits event which updates status bar + workspace list automatically
      
      const tracker = validator.getTracker();
      const currentCfg = await config.get(folder);
      const shouldRefresh = tracker.updateAndCheckRefresh(result, currentCfg.ignoreFilter.globs);
      
      if (shouldRefresh) {
        logConfig(result.workspaceId, 'configuration valid - triggering auto-refresh');
        
        Promise.resolve(vscode.commands.executeCommand('livesync.refresh', folder))
          .then(() => logOperation(result.workspaceId, 'refresh', 'completed successfully'))
          .catch(err => {
            const errMsg = err instanceof Error ? err.message : 'unknown error';
            logOperation(result.workspaceId, 'refresh error', errMsg);
          });
      } else if (!result.isValid && result.error) {
        logConfig(result.workspaceId, `validation failed: ${result.error}`);
      }
    })
  );
}