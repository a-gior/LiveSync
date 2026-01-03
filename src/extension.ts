import * as path from 'path';

require('module-alias').addAliases({
  '@ext': path.join(__dirname, 'extension'),
  '@domain': path.join(__dirname, 'domain'),
  '@app': path.join(__dirname, 'application'),
  '@infra': path.join(__dirname, 'infrastructure'),
  '@helpers': path.join(__dirname, 'infrastructure/helpers'),
  '@presentation': path.join(__dirname, 'presentation'),
  '@shared': path.join(__dirname, '../shared'),
  '@resources': path.join(__dirname, '../resources')
});

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
import { runMigrationCheck } from '@infra/migration/ConfigMigration';
import { registerTestCommands } from './extension/commands/test';
import { registerDelete } from './extension/commands/delete';

let globalServices: Awaited<ReturnType<typeof bootstrap>> | undefined;

export async function activate(context: vscode.ExtensionContext) {
  logInfoMessage('LiveSync activating…');

  // Auto-migrate old settings (aka 1.0.9) → .vscode/livesync.json
  await runMigrationCheck(context);

  // Decorations
  const deco = new FileStatusDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(deco));

  // Build core services
  const services = await bootstrap(context);
  globalServices = services;

  // File event auto-actions (save/create/delete/move)
  const bridge = new FileEventBridge(services.state, services.config, services.validator, services.remote, services.notifications);
  bridge.register(context.subscriptions);

  // Commands
  registerViewToolbar(services);
  registerViewCommands(services);
  registerShowDiff(services);
  registerConfigurationCommands(services);
  registerTestConnectionCommand(services);
  registerUploadDownload(services);
  registerDelete(services);
  registerTestCommands(services);

  logInfoMessage('LiveSync activated.');
  return {
    getServices: () => globalServices,
  };
}

export async function deactivate() {
  // Flush any pending cache writes before shutdown
  if (globalServices?.cachePersister) {
    await globalServices.cachePersister.forceFlush();
  }

  logInfoMessage('LiveSync deactivated.');
}