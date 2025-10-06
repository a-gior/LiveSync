import * as vscode from 'vscode';
import { DefaultDiffEngine } from '../domain/diff/DiffEngine';
import { SyncStateManager } from '../application/SyncStateManager';
import { ExperimentalTreeProvider, ExperimentalNode } from '../presentation/tree/ExperimentalTreeProvider';
import { WorkspaceConfigService } from '../infrastructure/config/WorkspaceConfigService';
import type { RemotePort } from '../application/ports/RemotePort';
import { ProgressService } from '../presentation/statusbar/ProgressService';

export interface Services {
  context: vscode.ExtensionContext;
  diffEngine: DefaultDiffEngine;
  state: SyncStateManager;
  config: WorkspaceConfigService;
  remote: RemotePort;
  provider: ExperimentalTreeProvider;
  treeView: vscode.TreeView<ExperimentalNode>;
  progress: ProgressService;
}
