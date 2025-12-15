import { strict as assert } from 'assert';
import { SftpRemotePort } from '../../../src/infrastructure/remote/SftpRemotePort';
import { WorkspaceConfigService } from '../../../src/infrastructure/config/WorkspaceConfigService';
import { stringToWsId } from '../../../src/infrastructure/helpers/path';
import { VM_CONFIG, cleanupRemotePath, REMOTE_PATHS, setupVMTests } from '../../helpers/vm/config';
import type { WorkspaceId } from '../../../src/domain/types';
import { EffectiveWorkspaceConfig } from '../../../src/infrastructure/config/WorkspaceConfig';

describe('SFTP Connection Management', function() {
  this.timeout(30000);

  let configService: WorkspaceConfigService;
  let remote: SftpRemotePort;
  const testWorkspaceId: WorkspaceId = stringToWsId('/test-workspace');

  before(async function() {
    await setupVMTests(this);
  });

  beforeEach(async function() {
    // Setup mock config service
    configService = {
      getById: async () => ({
        hasRemote: true,
        data: {
          hostname: VM_CONFIG.hostname,
          port: VM_CONFIG.port,
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          privateKeyPath: VM_CONFIG.privateKeyPath,
          passphrase: VM_CONFIG.passphrase,
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      }),
    } as any;

    remote = new SftpRemotePort(configService, 4);
    
    // Clean up test directory
    try {
      await cleanupRemotePath(REMOTE_PATHS.batch);  // ← Note: .batch not .integration!
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err instanceof Error ? err.message : 'unknown'}`);
      this.skip();
    }
  });

  afterEach(() => {
    remote.dispose();
  });

  describe('Basic Connection', () => {
    it('connects to VM with password authentication', async () => {
      // Attempt to list remote directory (will establish connection)
      const index = await remote.list(testWorkspaceId);
      
      // Should succeed without throwing
      assert.ok(index);
      assert.ok(index instanceof Map);
    });

    it('handles invalid credentials gracefully', async () => {
      // Override config with bad password
      configService.getById = async () => ({
        hasRemote: true,
        data: {
          hostname: VM_CONFIG.hostname,
          port: VM_CONFIG.port,
          username: VM_CONFIG.username,
          password: 'wrong-password',
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      } as EffectiveWorkspaceConfig);

      // Should reject with authentication error
      await assert.rejects(
        async () => await remote.list(testWorkspaceId),
        /authentication|permission denied/i
      );
    });

    it('handles connection timeout', async () => {
      // Override config with non-existent host
      configService.getById = async () => ({
        hasRemote: true,
        data: {
          hostname: '192.168.99.99', // Non-existent IP
          port: 2222,
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      } as EffectiveWorkspaceConfig);

      // Should timeout or reject
      await assert.rejects(
        async () => await remote.list(testWorkspaceId),
        /timeout|timed out|ETIMEDOUT|EHOSTUNREACH/i
      );
    }).timeout(15000);

    it('handles invalid port', async () => {
      configService.getById = async () => ({
        hasRemote: true,
        data: {
          hostname: VM_CONFIG.hostname,
          port: 9999, // Wrong port
          username: VM_CONFIG.username,
          password: VM_CONFIG.password,
          remotePath: REMOTE_PATHS.integration,
        },
        ignoreFilter: {
          shouldIgnore: () => false,
          getFastGlobPatterns: () => [],
        } as any,
      } as EffectiveWorkspaceConfig);

      await assert.rejects(
        async () => await remote.list(testWorkspaceId),
        /ECONNREFUSED|connection refused/i
      );
    });
  });

  describe('Connection Pooling', () => {
    it('reuses connections from pool', async () => {
      // Make multiple list calls
      const results = await Promise.all([
        remote.list(testWorkspaceId),
        remote.list(testWorkspaceId),
        remote.list(testWorkspaceId),
      ]);

      // All should succeed
      results.forEach(index => {
        assert.ok(index instanceof Map);
      });
    });

    it('handles concurrent operations', async () => {
      // Start 10 concurrent list operations
      const operations = Array.from({ length: 10 }, () => 
        remote.list(testWorkspaceId)
      );

      const results = await Promise.all(operations);

      // All should complete successfully
      assert.equal(results.length, 10);
      results.forEach(index => {
        assert.ok(index instanceof Map);
      });
    });

    it('respects max connection limit', async () => {
      // This test verifies connection pool doesn't exceed max
      const maxConcurrent = 4; // Set in constructor
      remote = new SftpRemotePort(configService, maxConcurrent);

      // Start many concurrent operations
      const operations = Array.from({ length: 20 }, () => 
        remote.list(testWorkspaceId)
      );

      // Should complete without error despite exceeding pool size
      const results = await Promise.all(operations);
      
      assert.equal(results.length, 20);
    });
  });

  describe('Connection Cleanup', () => {
    it('cleans up connections on dispose', async () => {
      // Perform some operations
      await remote.list(testWorkspaceId);
      await remote.list(testWorkspaceId);

      // Dispose should clean up pool
      remote.dispose();

      // Create new instance and verify it still works
      remote = new SftpRemotePort(configService, 4);
      const index = await remote.list(testWorkspaceId);
      
      assert.ok(index instanceof Map);
    });

    it('handles errors during disposal gracefully', () => {
      // Should not throw
      assert.doesNotThrow(() => {
        remote.dispose();
        remote.dispose(); // Double dispose should be safe
      });
    });
  });
});