import * as vscode from 'vscode';
import { DefaultDiffEngine } from '../domain/diff/DiffEngine';
import { SyncStateManager } from '../application/SyncStateManager';
import { WorkspaceConfigService } from '../infrastructure/config/WorkspaceConfigService';
import { SftpRemotePort } from '../infrastructure/remote/SftpRemotePort';
import type { RemotePort } from '../application/ports/RemotePort';
import { FolderStateStore } from '../presentation/tree/FolderStateStore';
import { ProgressService } from '../presentation/statusbar/ProgressService';
import { ConfigValidator } from '../infrastructure/config/ConfigValidator';
import { basenameRel } from '../infrastructure/helpers/path';
import { WorkspaceId } from '../domain/types';
import type { Services } from './services';

import { setupWorkspaceViews } from './setupWorkspaceViews';
import { registerConfigChangeHandler } from './registerConfigChangeHandler';
import { initializeInfrastructure } from './initialization';
import { DebouncedCachePersister } from '../infrastructure/persistence/DebouncedCachePersister';
import { registerWorkspaceFolderHandler } from './registerWorkspaceFolderHandler';
import { NotificationStatusBar } from '../presentation/statusbar/NotificationStatusBar';
import { ConfigStatusBar } from '../presentation/statusbar/ConfigStatusBar';
import { logErrorMessage } from '../infrastructure/helpers/logging';
import { findWorkspaceFolderById, getWorkspaceIds } from '../infrastructure/helpers/workspaceFolder';

export async function bootstrap(context: vscode.ExtensionContext): Promise<Services> {
  
  // Core domain and application services
  const diffEngine = new DefaultDiffEngine();
  const state = new SyncStateManager(diffEngine);

  // Configuration
  const config = new WorkspaceConfigService();
  const validator = new ConfigValidator(config);

  // Status bars
  const progress = new ProgressService();
  const notifications = new NotificationStatusBar();
  const configStatus = new ConfigStatusBar(validator);
  
  // Register disposables
  context.subscriptions.push(progress);
  context.subscriptions.push(notifications);
  context.subscriptions.push(configStatus);
  
  // On startup: Quick reachability check (2s timeout per host)
  const validationResults = await validator.validateAll(false, true);
  validator.getTracker().initialize(validationResults, config);

  // Remote connection
  const remote: RemotePort = new SftpRemotePort(config, 4);

  // Workspace setup
  const workspaceIds = getWorkspaceIds();
  const isMultiRoot = workspaceIds.length > 1;
  await vscode.commands.executeCommand('setContext', 'livesync.multiRoot', isMultiRoot);

  const folderState = new FolderStateStore(context.workspaceState);

  // Initialize infrastructure (storage, caching, logging)
  const { localCache, remoteCache } = await initializeInfrastructure(context, state, validator);

  const cachePersister = new DebouncedCachePersister(state, localCache, remoteCache, 1000);
  context.subscriptions.push({
    dispose: () => {
      cachePersister.dispose();
    }
  });

  // Setup workspace views (diffs tree + workspace list if multi-root)
  const views = setupWorkspaceViews(workspaceIds, state, folderState, context.workspaceState, validator);

  const showAsTree = context.workspaceState.get<boolean>('livesync.view.showAsTree', true);
  const showUnchanged = context.workspaceState.get<boolean>('livesync.view.showUnchanged', false);
  
  // Initialize view preferences from workspace state
  await vscode.commands.executeCommand('setContext', 'livesyncViewMode', showAsTree ? 'tree' : 'list');
  views.diffsProvider.setShowAsTree(showAsTree);
  views.diffsProvider.setShowUnchanged(showUnchanged);

  // Initialize config status bar for ALL workspaces (works for both single and multi-root)
  for (const result of validationResults) {
    const folder = findWorkspaceFolderById(result.workspaceId);
    if(!folder) {
      logErrorMessage(`Workspace "${basenameRel(result.workspaceId)}" not found`);
      continue;
    }
    
    views.listProvider?.updateConfigStatus(
      result.workspaceId,
      result.hasConfig,
      result.isValid
    );
  }

  // Shared mutable container for workspace list (allows dynamic creation on single→multi-root transition)
  const workspaceListContainer = {
    provider: views.listProvider,
    view: views.listView,
  };

  // Register config change handler (quick validation on config changes)
  registerConfigChangeHandler(config, validator, context);
  
  // Register workspace folder changes handler (add/remove folders, dynamic view creation)
  registerWorkspaceFolderHandler(
    validator,
    views.diffsProvider,
    context.workspaceState,
    configStatus,
    context,
    workspaceListContainer
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('livesync.selectWorkspace', (wsId: WorkspaceId) => {
      workspaceListContainer.provider?.selectWorkspace(wsId);
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
    workspaceListProvider: workspaceListContainer.provider,
    cachePersister,
  };
}