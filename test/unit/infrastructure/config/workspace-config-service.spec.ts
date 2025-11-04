import { strict as assert } from 'assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { WorkspaceConfigService } from '../../../../src/infrastructure/config/WorkspaceConfigService';
import { stringToWsId } from '../../../../src/infrastructure/helpers/path';
import { WorkspaceConfigData } from '../../../../src/infrastructure/config/WorkspaceConfig';

/**
 * Phase 3: WorkspaceConfigService Unit Tests
 * 
 * Tests configuration loading, parsing, validation, and caching.
 */
describe('WorkspaceConfigService (Phase 3)', () => {
  let tempDir: string;
  let configService: WorkspaceConfigService;

  beforeEach(async () => {
    // Create temp directory for test workspace
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'livesync-config-test-'));
    
    // Mock extension context
    const mockContext = {
      subscriptions: []
    } as any;
    
    configService = new WorkspaceConfigService(mockContext);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('Could not clean temp directory:', err);
    }
  });

  async function createConfigFile(config: Partial<WorkspaceConfigData>) {
    const vscodeDir = path.join(tempDir, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });
    
    const configPath = path.join(vscodeDir, 'livesync.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  describe('Config Loading', () => {
    it('loads valid config file', async () => {
      const config: WorkspaceConfigData = {
        hostname: '192.168.1.17',
        port: 22,
        username: 'centos',
        password: 'centos',
        remotePath: '/home/centos/vscode-tests',
        ignoreList: ['.vscode', '.git']
      };
      
      await createConfigFile(config);
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, true);
      assert.equal(eff.data.hostname, '192.168.1.17');
      assert.equal(eff.data.port, 22);
      assert.equal(eff.data.username, 'centos');
      assert.equal(eff.data.remotePath, '/home/centos/vscode-tests');
    });

    it('returns empty config when file does not exist', async () => {
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, false);
      assert.deepEqual(eff.data, {});
      assert.deepEqual(eff.ignoreGlobs, []);
    });

    it('handles malformed JSON gracefully', async () => {
      const vscodeDir = path.join(tempDir, '.vscode');
      await fs.mkdir(vscodeDir, { recursive: true });
      
      const configPath = path.join(vscodeDir, 'livesync.json');
      await fs.writeFile(configPath, '{ invalid json }');
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, false);
      assert.deepEqual(eff.data, {});
    });

    it('loads partial config with defaults', async () => {
      await createConfigFile({
        hostname: '192.168.1.17',
        username: 'test',
        password: 'test'
        // Missing remotePath
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, false); // No remotePath means not configured
      assert.equal(eff.data.hostname, '192.168.1.17');
    });
  });

  describe('hasRemote Detection', () => {
    it('returns hasRemote=true when hostname and remotePath present', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/remote/path',
        username: 'user',
        password: 'pass'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, true);
    });

    it('returns hasRemote=false when hostname missing', async () => {
      await createConfigFile({
        remotePath: '/remote/path',
        username: 'user',
        password: 'pass'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, false);
    });

    it('returns hasRemote=false when remotePath missing', async () => {
      await createConfigFile({
        hostname: 'example.com',
        username: 'user',
        password: 'pass'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, false);
    });
  });

  describe('Ignore Glob Compilation', () => {
    it('converts ignoreList to glob patterns', async () => {
        await createConfigFile({
            hostname: 'example.com',
            remotePath: '/path',
            ignoreList: ['.vscode', 'node_modules']
        });

        const workspaceId = stringToWsId(tempDir);
        const eff = await configService.getById(workspaceId);

        // toExcludeGlobs preserves dots and creates patterns:
        // ".vscode" => ["**/.vscode/**", "**/.vscode"]
        // "node_modules" => ["**/node_modules/**", "**/node_modules"]
        assert.ok(eff.ignoreGlobs.includes('**/.vscode/**'));
        assert.ok(eff.ignoreGlobs.includes('**/.vscode'));
        assert.ok(eff.ignoreGlobs.includes('**/node_modules/**'));
        assert.ok(eff.ignoreGlobs.includes('**/node_modules'));
        assert.equal(eff.ignoreGlobs.length, 4);
    });

    it('sanitizes ignore entries with leading dots/slashes', async () => {
        await createConfigFile({
            hostname: 'example.com',
            remotePath: '/path',
            ignoreList: ['../.vscode', './node_modules', '/.git']
        });

        const workspaceId = stringToWsId(tempDir);
        const eff = await configService.getById(workspaceId);

        // After removing leading "../", "./", "/" the patterns preserve dots in names:
        // "../.vscode" => ".vscode" => ["**/.vscode/**", "**/.vscode"]
        // "./node_modules" => "node_modules" => ["**/node_modules/**", "**/node_modules"]
        // "/.git" => ".git" => ["**/.git/**", "**/.git"]
        assert.ok(eff.ignoreGlobs.includes('**/.vscode/**'));
        assert.ok(eff.ignoreGlobs.includes('**/node_modules/**'));
        assert.ok(eff.ignoreGlobs.includes('**/.git/**'));
        assert.equal(eff.ignoreGlobs.length, 6);
    });

    it('handles empty ignoreList', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path',
        ignoreList: []
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.deepEqual(eff.ignoreGlobs, []);
    });

    it('handles missing ignoreList', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.deepEqual(eff.ignoreGlobs, []);
    });
  });

  describe('Config Caching', () => {
    it('caches config after first load', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path'
      });
      
      const workspaceId = stringToWsId(tempDir);
      
      // First load
      const eff1 = await configService.getById(workspaceId);
      
      // Modify config file
      await createConfigFile({
        hostname: 'different.com',
        remotePath: '/path'
      });
      
      // Second load should return cached value
      const eff2 = await configService.getById(workspaceId);
      
      assert.equal(eff1.data.hostname, 'example.com');
      assert.equal(eff2.data.hostname, 'example.com'); // Still cached
    });
  });

  describe('Action Policies', () => {
    it('loads action policies from config', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path',
        actionOnSave: 'check&save',
        actionOnCreate: 'check&create',
        actionOnDelete: 'none',
        actionOnMove: 'check&move',
        actionOnOpen: 'check&download'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.data.actionOnSave, 'check&save');
      assert.equal(eff.data.actionOnCreate, 'check&create');
      assert.equal(eff.data.actionOnDelete, 'none');
      assert.equal(eff.data.actionOnMove, 'check&move');
      assert.equal(eff.data.actionOnOpen, 'check&download');
    });

    it('handles missing action policies', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      // Should be undefined if not specified
      assert.equal(eff.data.actionOnSave, undefined);
      assert.equal(eff.data.actionOnCreate, undefined);
    });
  });

  describe('Authentication Methods', () => {
    it('loads password authentication', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path',
        username: 'user',
        password: 'secret'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.data.username, 'user');
      assert.equal(eff.data.password, 'secret');
    });

    it('loads private key authentication', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path',
        username: 'user',
        privateKeyPath: '/path/to/key',
        passphrase: 'keyphrase'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.data.privateKeyPath, '/path/to/key');
      assert.equal(eff.data.passphrase, 'keyphrase');
    });
  });

  describe('Port Configuration', () => {
    it('loads custom port', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path',
        port: 2222
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.data.port, 2222);
    });

    it('handles missing port (defaults to undefined)', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      // Port should default to 22 in the SFTP connection logic, not here
      assert.equal(eff.data.port, undefined);
    });
  });

  describe('Real-World Config Examples', () => {
    it('loads VM test config', async () => {
      await createConfigFile({
        hostname: '192.168.1.17',
        port: 22,
        username: 'centos',
        password: 'centos',
        remotePath: '/home/centos/vscode-tests',
        actionOnUpload: 'check&upload',
        actionOnDownload: 'check&download',
        actionOnSave: 'check&save',
        actionOnCreate: 'check&create',
        actionOnDelete: 'none',
        actionOnMove: 'check&move',
        actionOnOpen: 'check&download',
        ignoreList: ['.livesync', '.vscode', '.svn']
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, true);
      assert.equal(eff.data.hostname, '192.168.1.17');
      assert.equal(eff.data.port, 22);
      assert.equal(eff.data.username, 'centos');
      assert.equal(eff.data.password, 'centos');
      assert.equal(eff.data.remotePath, '/home/centos/vscode-tests');
      assert.equal(eff.data.actionOnSave, 'check&save');
      assert.equal(eff.ignoreGlobs.length, 6); // 3 entries × 2 patterns each
    });

    it('loads production config', async () => {
      await createConfigFile({
        hostname: 'prod-server.example.com',
        port: 22,
        username: 'deploy',
        privateKeyPath: '~/.ssh/id_rsa',
        remotePath: '/var/www/app',
        actionOnSave: 'none',
        actionOnUpload: 'upload',
        ignoreList: ['node_modules', '.git', '.env', 'dist']
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.hasRemote, true);
      assert.equal(eff.data.hostname, 'prod-server.example.com');
      assert.equal(eff.data.privateKeyPath, '~/.ssh/id_rsa');
      assert.equal(eff.data.actionOnSave, 'none');
      assert.equal(eff.data.actionOnUpload, 'upload');
    });
  });

  describe('Edge Cases', () => {
    it('handles very long remote paths', async () => {
      const longPath = '/very/long/path/' + 'nested/'.repeat(50) + 'end';
      
      await createConfigFile({
        hostname: 'example.com',
        remotePath: longPath
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.data.remotePath, longPath);
    });

    it('handles special characters in config values', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/path/with spaces/and-special_chars',
        username: 'user@domain.com',
        password: 'p@ssw0rd!#$%'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.data.username, 'user@domain.com');
      assert.equal(eff.data.password, 'p@ssw0rd!#$%');
    });

    it('handles Unicode in config', async () => {
      await createConfigFile({
        hostname: 'example.com',
        remotePath: '/home/用户/workspace',
        username: 'ユーザー'
      });
      
      const workspaceId = stringToWsId(tempDir);
      const eff = await configService.getById(workspaceId);
      
      assert.equal(eff.data.remotePath, '/home/用户/workspace');
      assert.equal(eff.data.username, 'ユーザー');
    });
  });
});