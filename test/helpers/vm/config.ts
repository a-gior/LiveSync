/**
 * VM Configuration for Integration Tests - FIXED
 */

import { ConfigValidator } from '../../../src/infrastructure/config/ConfigValidator';

export const VM_CONFIG = {
  hostname: '127.0.0.1',
  port: 2222,
  username: 'centos',
  password: 'centos',
  privateKeyPath: '',
  passphrase: '',
  remotePath: '/home/centos/test-workspace',
  actionOnUpload: 'check&upload',
  actionOnDownload: 'check&download',
  actionOnSave: 'check&save',
  actionOnCreate: 'check&create',
  actionOnDelete: 'none',
  actionOnMove: 'check&move',
  actionOnOpen: 'check&download',
  ignoreList: ['.livesync', '.vscode', '.svn']
} as const;

export const REMOTE_PATHS = {
  integration: '/home/centos/test-integration',
  e2e: '/home/centos/test-e2e',
  batch: '/home/centos/test-batch',
  cache: '/home/centos/test-cache',
  conflicts: '/home/centos/test-conflicts',
} as const;

/**
 * Clean up remote test directories - FIXED to use 'exit' event
 */
export async function cleanupRemotePath(remotePath: string): Promise<void> {
  const { Client } = await import('ssh2');
  
  return new Promise((resolve, reject) => {
    const client = new Client();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.end();
        client.destroy();
        reject(new Error(`Cleanup timeout for ${remotePath}`));
      }
    }, 10000);

    client
      .on('ready', () => {
        const cmd = `rm -rf "${remotePath}" && mkdir -p "${remotePath}"`;
        
        client.exec(cmd, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            client.end();
            if (!resolved) {
              resolved = true;
              reject(err);
            }
            return;
          }

          let errorOutput = '';

          stream.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
          });

          // FIXED: Use 'exit' event instead of 'close'
          stream.on('exit', (code: number) => {
            clearTimeout(timeout);
            client.end();
            
            if (!resolved) {
              resolved = true;
              
              if (code !== 0) {
                reject(new Error(`Cleanup failed with code ${code}: ${errorOutput}`));
              } else {
                resolve();
              }
            }
          });

          stream.on('error', (err: Error) => {
            clearTimeout(timeout);
            client.end();
            
            if (!resolved) {
              resolved = true;
              reject(err);
            }
          });
        });
      })
      .on('error', (err: Error) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

    client.connect({
      host: VM_CONFIG.hostname,
      port: VM_CONFIG.port,
      username: VM_CONFIG.username,
      password: VM_CONFIG.password,
      readyTimeout: 5000,
    });
  });
}

/**
 * Test suite setup helper
 */
export async function setupVMTests(context: Mocha.Context): Promise<boolean> {
    const connectionTest = await ConfigValidator.testConnection(VM_CONFIG);
    if (!connectionTest.success) {
      console.log('\n⚠️  VM not accessible at 127.0.0.1:2222');
      console.log('Integration tests will be skipped.');
      console.log('\nTo run integration tests:');
      console.log('1. Start your CentOS VM');
      console.log('2. Verify SSH: ssh centos@127.0.0.1 -p 2222');
      console.log('3. Re-run tests\n');
      context.skip();
      return false;
    }
  
  return true;
}