/**
 * Test controller for E2E tests
 * Allows tests to control dialog responses in automated testing
 */

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