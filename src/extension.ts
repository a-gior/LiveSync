import * as vscode from 'vscode';

import { bootstrap } from './extension/bootstrap';
import { registerViewCommands } from './extension/commands/view';
import { registerIndexLocal } from './extension/commands/indexLocal';
import { registerApplyToRemote } from './extension/commands/applyToRemote';
import { registerApplyFromRemote } from './extension/commands/applyFromRemote';
import { registerShowDiff } from './extension/commands/showDiff';
import { FileEventBridge } from './presentation/events/FileEventBridge';
import { registerRemotePresence } from './extension/remotePresence';
import { registerViewToolbar } from './extension/commands/viewToolbar';
import { registerConflictResolver } from './extension/commands/conflictResolver';
import { FileStatusDecorationProvider } from '@presentation/decoration/FileStatusDecorationProvider';
import { logInfoMessage } from './infrastructure/helpers/logging';

export async function activate(context: vscode.ExtensionContext) {
  logInfoMessage('LiveSync activating…');

  // Decorations
  const deco = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(deco));

  // Build core services
  const services = await bootstrap(context);
  registerRemotePresence(services);

  // File event auto-actions (save/create/delete/rename)
  const bridge = new FileEventBridge(services.state, services.config, services.remote, services.remoteCache);
  bridge.register(context.subscriptions);

  // Commands
  registerConflictResolver(services);
  registerViewToolbar(services);
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
