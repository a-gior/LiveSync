import * as vscode from 'vscode';
import { DefaultDiffEngine } from '../domain/diff/DiffEngine';
import { SyncStateManager } from '../application/SyncStateManager';
import { WorkspaceConfigService } from '../infrastructure/config/WorkspaceConfigService';
import { SftpRemotePort } from '../infrastructure/remote/SftpRemotePort';
import { ChoosingRemotePort } from '../infrastructure/remote/ChoosingRemotePort';
import type { RemotePort } from '../application/ports/RemotePort';
import { FolderStateStore } from '../presentation/tree/FolderStateStore';
import { ProgressService } from '../presentation/statusbar/ProgressService';
import { ConfigValidator } from '../infrastructure/config/ConfigValidator';
import { stringToWsId } from '../infrastructure/helpers/path';
import { WorkspaceId } from '../domain/types';
import type { Services } from './services';

import { setupWorkspaceViews } from './setupWorkspaceViews';
import { registerConfigChangeHandler } from './registerConfigChangeHandler';
import { initializeInfrastructure } from './initialization';
import { DebouncedCachePersister } from '../infrastructure/persistence/DebouncedCachePersister';
import { registerWorkspaceFolderHandler } from './registerWorkspaceFolderHandler';
import { NotificationStatusBar } from '../presentation/statusbar/NotificationStatusBar';
import { ConfigStatusBar } from '../presentation/statusbar/ConfigStatusBar';

export async function bootstrap(context: vscode.ExtensionContext): Promise<Services> {
  // Core domain and application services
  const diffEngine = new DefaultDiffEngine();
  const state = new SyncStateManager(diffEngine);

  // Configuration
  const config = new WorkspaceConfigService(context);
  const validator = new ConfigValidator(config);

  // Status bars
  const progress = new ProgressService();
  const notifications = new NotificationStatusBar();
  const configStatus = new ConfigStatusBar();
  
  // Register disposables
  context.subscriptions.push(progress);
  context.subscriptions.push(notifications);
  context.subscriptions.push(configStatus);
  
  // On startup: Quick reachability check (2s timeout per host)
  // This is fast enough for startup while still catching unreachable hosts
  const validationResults = await validator.validateAll(false, true);
  validator.getTracker().initialize(validationResults);

  // Remote connection
  const sftpRemote = new SftpRemotePort(config, 4);
  const remote: RemotePort = new ChoosingRemotePort(config, sftpRemote);

  // Workspace setup
  const workspaceIds = (vscode.workspace.workspaceFolders ?? []).map(f => stringToWsId(f.uri.fsPath));
  const isMultiRoot = workspaceIds.length > 1;
  await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', isMultiRoot);

  const folderState = new FolderStateStore(context.workspaceState);

  // Initialize infrastructure (storage, caching, logging)
  const { localCache, remoteCache } = await initializeInfrastructure(context, state, config);

  const cachePersister = new DebouncedCachePersister(state, localCache, remoteCache, 1000);
  context.subscriptions.push({
    dispose: () => {
      cachePersister.dispose();
    }
  });

  // Setup workspace views (diffs tree + workspace list if multi-root)
  const views = setupWorkspaceViews(workspaceIds, state, folderState);

  // Initialize config status bar for ALL workspaces (works for both single and multi-root)
  for (const result of validationResults) {
    const folder = vscode.workspace.workspaceFolders?.find(
      f => stringToWsId(f.uri.fsPath) === result.workspaceId
    );
    
    if (!folder) continue;

    let hostname: string | undefined;
    let remotePath: string | undefined;
    
    if (result.isValid) {
      try {
        const cfg = await config.get(folder);
        hostname = cfg.data.hostname;
        remotePath = cfg.data.remotePath;
      } catch {
        // Ignore
      }
    }
    
    configStatus.updateWorkspaceStatus(
      result.workspaceId,
      result,
      hostname,
      remotePath,
      folder.name
    );

    views.listProvider?.updateConfigStatus(
      result.workspaceId,
      result.hasConfig,
      result.isValid
    );
  }

  // Register config change handler (quick validation on config changes)
  registerConfigChangeHandler(config, validator, views.listProvider, configStatus, context);
  // Register workspace folder changes handler (add/remove folders)
  registerWorkspaceFolderHandler(config, validator, views.listProvider, configStatus, context);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.selectWorkspace', (wsId: WorkspaceId) => {
      views.listProvider?.selectWorkspace(wsId);
    })
  );

  // Register view disposables
  context.subscriptions.push(views.diffsView);
  if (views.listView) {
    context.subscriptions.push(views.listView);
  }

  return {
    context,
    diffEngine,
    state,
    config,
    validator,
    remote,
    provider: views.diffsProvider,
    treeView: views.diffsView,
    localCache,
    remoteCache,
    progress, 
    notifications, 
    configStatus,
    workspaceListProvider: views.listProvider,
    cachePersister,
  };
}