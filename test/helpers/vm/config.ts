/**
 * VM configuration for integration and E2E tests
 * 
 * Prerequisites:
 * - VM running at 127.0.0.1:2222
 * - SSH accessible
 * - Credentials: centos/centos
 */

export const VM_CONFIG = {
  hostname: '127.0.0.1',
  port: 2222,
  username: 'centos',
  password: 'centos',
  remotePath: '/home/centos/test-workspace'
};

/**
 * Alternative remote paths for different test scenarios
 */
export const REMOTE_PATHS = {
  integration: '/home/centos/test-integration',
  e2e: '/home/centos/test-e2e',
  cache: '/home/centos/test-cache',
  batch: '/home/centos/test-batch',
  conflicts: '/home/centos/test-conflicts'
};

export const RUN_INTEGRATION_TESTS = true;
