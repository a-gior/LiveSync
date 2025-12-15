/**
 * VM Configuration for Integration Tests - FIXED
 */

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
 * Check if VM is accessible - FIXED to use 'exit' event instead of 'close'
 */
export async function isVMAccessible(): Promise<boolean> {
  const { Client } = await import('ssh2');
  
  return new Promise<boolean>((resolve) => {
    const client = new Client();
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.end();
        client.destroy();
        console.log('⚠️  VM connection timeout');
        resolve(false);
      }
    }, 5000);

    client
      .on('ready', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          
          client.exec('echo "test"', (err, stream) => {
            if (err) {
              client.end();
              resolve(false);
              return;
            }

            // FIXED: Use 'exit' event which is more reliable than 'close'
            stream.on('exit', (code: number) => {
              client.end();
              if (code === 0) {
                console.log('✓ VM is accessible');
                resolve(true);
              } else {
                console.log('⚠️  VM command failed with code:', code);
                resolve(false);
              }
            });
            
            // Also handle errors
            stream.on('error', (streamErr: Error) => {
              client.end();
              console.log('⚠️  Stream error:', streamErr.message);
              resolve(false);
            });
          });
        }
      })
      .on('error', (err: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('⚠️  VM connection error:', err.message);
          resolve(false);
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
  const accessible = await isVMAccessible();
  
  if (!accessible) {
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