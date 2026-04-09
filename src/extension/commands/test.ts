/**
 * Register test-only commands for E2E testing
 * These commands allow automated tests to control extension behavior
 */

import {
  enableTestMode,
  disableTestMode,
  setTestConflictResponse,
  waitForIdle
} from '@helpers/test';
import type { Services } from '../services';
import { cmd } from '../cmd';
import { findWorkspaceFolderById } from '@infra/helpers/workspaceFolder';
import { stringToWsId } from '@helpers/path';

export function registerTestCommands(services: Services): void {
  const { context, config, validator } = services;

    // Enable test mode
    cmd(context, 'livesync.test.enableTestMode', () => {
        enableTestMode();
    });

    // Disable test mode
    cmd(context, 'livesync.test.disableTestMode', () => {
        disableTestMode();
    });

    // Set auto-response for conflict prompts in tests
    cmd(context, 'livesync.test.setConflictResponse',
      (response: 'proceed' | 'cancel' | 'ignore' | 'diff' | null) => {
        setTestConflictResponse(response);
      }
    );

    // Wait until all file and workspace operations are complete
    // Optional settleMs arg: initial delay before polling (use when event handlers may not have
    // enqueued yet, e.g. after triggering onOpen which has a 50ms internal delay)
    cmd(context, 'livesync.test.waitForIdle', (settleMs?: number) => waitForIdle(10000, settleMs));

    // Force-reload config for a workspace folder path (bypasses file watcher delay)
    cmd(context, 'livesync.test.reloadConfig', async (fsPath: string) => {
      const workspaceId = stringToWsId(fsPath);
      const folder = findWorkspaceFolderById(workspaceId);
      if (folder) {
        await config.reloadFolder(folder);
        // Also validate to populate the validator cache, so subsequent livesync.refresh calls
        // don't show blocking "No remote configuration found" dialogs in test environments.
        await validator.validate(folder);
      }
    });
}