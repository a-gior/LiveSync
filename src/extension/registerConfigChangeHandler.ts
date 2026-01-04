import * as vscode from 'vscode';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { WorkspaceListProvider } from '@presentation/tree/WorkspaceListProvider';
import { ConfigStatusBar } from '@presentation/statusbar/ConfigStatusBar';
import { findWorkspaceFolderById } from '@infra/helpers/workspaceFolder';
import { WorkspaceId } from '../domain/types';
import { logConfig, logOperation } from '@helpers/logging';

export function registerConfigChangeHandler(
  config: WorkspaceConfigService,
  validator: ConfigValidator,
  workspaceListProvider: WorkspaceListProvider | undefined,
  configStatusBar: ConfigStatusBar,
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    config.onConfigChange(async (event: { workspaceId: WorkspaceId }) => {
      logConfig(event.workspaceId, 'configuration file changed');
      
      validator.clearCache(event.workspaceId);

      const folder = findWorkspaceFolderById(event.workspaceId);
      const result = await validator.validate(folder, false, true);
      const tracker = validator.getTracker();
      const currentCfg = await config.get(folder);
      
      const shouldRefresh = tracker.updateAndCheckRefresh(result, currentCfg.ignoreFilter.globs);
      
      if (workspaceListProvider) {
        workspaceListProvider.updateConfigStatus(
          result.workspaceId,
          result.hasConfig,
          result.isValid
        );
      }

      await updateConfigStatusForWorkspace(configStatusBar, config, folder, result);
      
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

async function updateConfigStatusForWorkspace(
  configStatusBar: ConfigStatusBar,
  config: WorkspaceConfigService,
  folder: vscode.WorkspaceFolder,
  result: ReturnType<typeof ConfigValidator.prototype.getCached>
): Promise<void> {
  let hostname: string | undefined;
  let remotePath: string | undefined;
  
  if (result.isValid) {
    try {
      const cfg = await config.get(folder);
      hostname = cfg.data.hostname;
      remotePath = cfg.data.remotePath;
    } catch {
       // Ignore - validation errors already logged
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