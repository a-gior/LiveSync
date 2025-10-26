import * as vscode from 'vscode';

import { bootstrap } from './extension/bootstrap';
import { registerViewCommands } from './extension/commands/view';
import { registerShowDiff } from './extension/commands/showDiff';
import { FileEventBridge } from './presentation/events/FileEventBridge';
import { registerViewToolbar } from './extension/commands/viewToolbar';
import { FileStatusDecorationProvider } from '@presentation/decoration/FileStatusDecorationProvider';
import { logInfoMessage } from './infrastructure/helpers/logging';
import { registerConfigurationCommands } from './extension/commands/configuration';
import { registerTestConnectionCommand } from './extension/commands/testConnection';
import { registerUploadDownload } from './extension/commands/uploadDownload';

export async function activate(context: vscode.ExtensionContext) {
  logInfoMessage('LiveSync activating…');

  // Decorations
  const deco = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(deco));

  // Build core services
  const services = await bootstrap(context);

  // Initialize view mode context and provider
  const cfg = vscode.workspace.getConfiguration('livesync');
  const showAsTree = cfg.get<boolean>('view.showAsTree') ?? true;
  await vscode.commands.executeCommand('setContext', 'livesyncViewMode', showAsTree ? 'tree' : 'list');
  services.provider.setShowAsTree(showAsTree);

  // File event auto-actions (save/create/delete/rename)
  const bridge = new FileEventBridge(services.state, services.config, services.remote, services.remoteCache);
  bridge.register(context.subscriptions);

  // Commands
  registerViewToolbar(services);
  registerViewCommands(services);
  registerShowDiff(services);
  registerConfigurationCommands(services);
  registerTestConnectionCommand(services);
  registerUploadDownload(services);

  logInfoMessage('LiveSync activated.');
}

export function deactivate() {
  logInfoMessage('LiveSync deactivated.');
}
