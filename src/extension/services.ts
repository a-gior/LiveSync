import * as vscode from 'vscode';
import { DefaultDiffEngine } from '../domain/diff/DiffEngine';
import { SyncStateManager } from '../application/SyncStateManager';
import { SyncStateTreeProvider, Node } from '../presentation/tree/SyncStateTreeProvider';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import type { RemotePort } from '../application/ports/RemotePort';
import { ProgressService } from '../presentation/statusbar/ProgressService';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { WorkspaceListProvider } from '../presentation/tree/WorkspaceListProvider';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { DebouncedCachePersister } from '@infra/persistence/DebouncedCachePersister';
import { NotificationStatusBar } from '../presentation/statusbar/NotificationStatusBar';
import { ConfigStatusBar } from '../presentation/statusbar/ConfigStatusBar';
import { RemoteIndexScheduler } from '../application/services/RemoteIndexScheduler';

export interface Services {
  context: vscode.ExtensionContext;
  diffEngine: DefaultDiffEngine;
  state: SyncStateManager;
  config: WorkspaceConfigService;
  validator: ConfigValidator;
  remote: RemotePort;
  provider: SyncStateTreeProvider;
  treeView: vscode.TreeView<Node>;
  progress: ProgressService;
  notifications: NotificationStatusBar;
  configStatus: ConfigStatusBar;
  localCache: IndexCacheService;
  remoteCache: IndexCacheService;
  baseCache: IndexCacheService;
  workspaceListProvider?: WorkspaceListProvider;
  cachePersister: DebouncedCachePersister;
  remoteIndexScheduler: RemoteIndexScheduler;
}
