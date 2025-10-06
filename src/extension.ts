import * as vscode from 'vscode';
import { WorkspaceConfigManager } from './managers/WorkspaceConfigManager';
import { logInfoMessage } from './managers/LogManager';
import { FileStatusDecorationProvider } from './services/FileDecorationProvider';

import { bootstrap } from './extension/bootstrap';
import { registerViewCommands } from './extension/commands/view';
import { registerIndexLocal } from './extension/commands/indexLocal';
import { registerApplyToRemote } from './extension/commands/applyToRemote';
import { registerApplyFromRemote } from './extension/commands/applyFromRemote';
import { registerShowDiff } from './extension/commands/showDiff';
import { FileEventBridge } from './presentation/events/FileEventBridge';
import { registerRemotePresence } from './extension/remotePresence';

export let configManager: WorkspaceConfigManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
  logInfoMessage('LiveSync activating…');

  // Decorations (unchanged)
  const decorations = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorations));

  // Build core services
  const services = await bootstrap(context);
  registerRemotePresence(services);

  // File event auto-actions (save/create/delete/rename)
  const bridge = new FileEventBridge(services.state, services.config, services.remote);
  bridge.register(context.subscriptions);

  // Commands
  registerViewCommands(services);
  registerIndexLocal(services);
  registerApplyToRemote(services);
  registerApplyFromRemote(services);
  registerShowDiff(services);

  logInfoMessage('LiveSync activated.');
}

export function deactivate() {
  logInfoMessage('LiveSync deactivated.');
}
