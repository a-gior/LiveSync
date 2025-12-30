/**
 * Register test-only commands for E2E testing
 * These commands allow automated tests to control extension behavior
 */

import { 
  enableTestMode, 
  disableTestMode, 
  setTestConflictResponse 
} from '@helpers/test';
import type { Services } from '../services';
import { cmd } from '../cmd';

export function registerTestCommands(services: Services): void {
  const { context } = services;

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
}