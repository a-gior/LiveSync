/**
 * Test controller for E2E tests
 * Allows tests to control dialog responses in automated testing
 */

import { fileOperationQueue } from '@helpers/concurrency';
import { workspaceOperationQueue } from '@helpers/concurrency';

type ConflictResponse = 'proceed' | 'cancel' | 'ignore' | 'diff' | null;

let testConflictResponse: ConflictResponse = null;
let _testMode = false;

/**
 * Enable test mode (call from test suiteSetup)
 */
export function enableTestMode(): void {
  _testMode = true;
  console.log('[LiveSync] Test mode ENABLED');
}

/**
 * Disable test mode (call from test suiteTeardown)
 */
export function disableTestMode(): void {
  _testMode = false;
  testConflictResponse = null; // Clear any pending responses
  console.log('[LiveSync] Test mode DISABLED');
}

/**
 * Check if running in test mode
 */
export function isTestMode(): boolean {
  return _testMode;
}

/**
 * Get the current test conflict response (null means no override)
 */
export function getTestConflictResponse(): ConflictResponse {
  return testConflictResponse;
}

/**
 * Set the auto-response for conflict prompts in test mode
 */
export function setTestConflictResponse(response: ConflictResponse): void {
  if (!_testMode) {
    console.warn('[LiveSync] Cannot set test response - test mode not enabled');
    return;
  }
  testConflictResponse = response;
}

/**
 * Wait until both queues (file operations + workspace operations) are fully idle.
 * Polls every 50ms. Use this in tests instead of fixed waits after triggering file events.
 *
 * @param timeoutMs - Maximum time to wait before throwing
 * @param settleMs - Initial delay before polling starts. Use this when an async event handler
 *                   (e.g. onOpen) may not have enqueued its operation yet at call time.
 */
export async function waitForIdle(timeoutMs = 10000, settleMs = 0): Promise<void> {
  if (settleMs > 0) {
    await new Promise(resolve => setTimeout(resolve, settleMs));
  }
  const deadline = Date.now() + timeoutMs;
  while (fileOperationQueue.getActiveCount() > 0 || workspaceOperationQueue.hasAnyPending()) {
    if (Date.now() > deadline) {
      throw new Error('[LiveSync] waitForIdle timed out');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}