import * as vscode from 'vscode';
import { DefaultDiffEngine } from '../domain/diff/DiffEngine';
import { SyncStateManager } from '../application/SyncStateManager';
import { ExperimentalTreeProvider, ExperimentalNode } from '../presentation/tree/ExperimentalTreeProvider';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import type { RemotePort } from '../application/ports/RemotePort';
import { ProgressService } from '../presentation/statusbar/ProgressService';
import { IndexCacheService } from '@infra/persistence/IndexCacheService';
import { WorkspaceListProvider } from '../presentation/tree/WorkspaceListProvider';
import { ConfigValidator } from '@infra/config/ConfigValidator';
import { DebouncedCachePersister } from '@infra/persistence/DebouncedCachePersister';
import { NotificationStatusBar } from '../presentation/statusbar/NotificationStatusBar';
import { ConfigStatusBar } from '../presentation/statusbar/ConfigStatusBar';

export interface Services {
  context: vscode.ExtensionContext;
  diffEngine: DefaultDiffEngine;
  state: SyncStateManager;
  config: WorkspaceConfigService;
  validator: ConfigValidator;
  remote: RemotePort;
  provider: ExperimentalTreeProvider;
  treeView: vscode.TreeView<ExperimentalNode>;
  progress: ProgressService;
  notifications: NotificationStatusBar;
  configStatus: ConfigStatusBar;
  localCache: IndexCacheService;
  remoteCache: IndexCacheService;
  workspaceListProvider?: WorkspaceListProvider;
  cachePersister: DebouncedCachePersister;
}
