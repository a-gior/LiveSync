/**
 * RemoteStateVerifier - Helper for verifying remote state in E2E tests
 * Uses SSH commands to check files actually exist/have correct content on remote server
 */

import { Client } from 'ssh2';

export interface RemoteConfig {
  hostname: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
}

export class RemoteStateVerifier {
  constructor(private config: RemoteConfig) {}

  /**
   * Check if a file exists on remote
   */
  async fileExists(relPath: string): Promise<boolean> {
    const fullPath = `${this.config.remotePath}/${relPath}`;
    const command = `test -f "${fullPath}" && echo "EXISTS" || echo "NOTEXISTS"`;
    
    try {
      const result = await this.executeCommand(command);
      return result.trim() === 'EXISTS';
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if a folder exists on remote
   */
  async folderExists(relPath: string): Promise<boolean> {
    const fullPath = relPath 
      ? `${this.config.remotePath}/${relPath}` 
      : this.config.remotePath;
    const command = `test -d "${fullPath}" && echo "EXISTS" || echo "NOTEXISTS"`;
    
    try {
      const result = await this.executeCommand(command);
      return result.trim() === 'EXISTS';
    } catch (err) {
      return false;
    }
  }

  /**
   * Read file content from remote
   */
  async readFile(relPath: string): Promise<string> {
    const fullPath = `${this.config.remotePath}/${relPath}`;
    const command = `cat "${fullPath}"`;
    return await this.executeCommand(command);
  }

  /**
   * List files in a remote directory
   */
  async listFiles(subPath?: string): Promise<string[]> {
    const fullPath = subPath 
      ? `${this.config.remotePath}/${subPath}` 
      : this.config.remotePath;
    const command = `find "${fullPath}" -type f -printf '%P\\n'`;
    
    const result = await this.executeCommand(command);
    return result.split('\n').filter(f => f.trim().length > 0);
  }

  /**
   * Delete a file from remote
   */
  async deleteFile(relPath: string): Promise<void> {
    const fullPath = `${this.config.remotePath}/${relPath}`;
    await this.executeCommand(`rm -f "${fullPath}"`);
  }

  /**
   * Delete a folder from remote (recursive)
   */
  async deleteFolder(relPath: string): Promise<void> {
    const fullPath = relPath 
      ? `${this.config.remotePath}/${relPath}` 
      : this.config.remotePath;
    await this.executeCommand(`rm -rf "${fullPath}"`);
  }

  /**
   * Create a file on remote with content
   */
  async createFile(relPath: string, content: string): Promise<void> {
    const fullPath = `${this.config.remotePath}/${relPath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    
    // Escape content for shell
    const escapedContent = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    
    // Use printf instead of echo to avoid automatic newline
    const cmd = `mkdir -p "${dir}" && printf "%s" "${escapedContent}" > "${fullPath}"`;
    await this.executeCommand(cmd);
  }

  /**
   * Clean the entire remote test directory
   */
  async cleanRemoteWorkspace(): Promise<void> {
    await this.executeCommand(`rm -rf "${this.config.remotePath}"/* "${this.config.remotePath}"/.*[!.]*`);
  }

  /**
   * Get file size on remote
   */
  async getFileSize(relPath: string): Promise<number> {
    const fullPath = `${this.config.remotePath}/${relPath}`;
    const command = `stat -c %s "${fullPath}"`;
    const result = await this.executeCommand(command);
    return parseInt(result.trim(), 10);
  }

  /**
   * Execute an arbitrary SSH command
   */
  async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      let errorOutput = '';

      const timeout = setTimeout(() => {
        conn.end();
        conn.destroy();
        reject(new Error(`Command timeout: ${command}`));
      }, 10000);

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            return reject(err);
          }

          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
          });

          stream.on('close', (code: number) => {
            clearTimeout(timeout);
            conn.end();
            
            if (code !== 0 && errorOutput) {
              reject(new Error(`Command failed (exit ${code}): ${errorOutput}`));
            } else {
              resolve(output);
            }
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      conn.connect({
        host: this.config.hostname,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        readyTimeout: 10000,
      });
    });
  }

  dispose() {
    // Cleanup if needed
  }
}

/**
 * Standard VM config for E2E tests
 */
export const E2E_VM_CONFIG: RemoteConfig = {
  hostname: '127.0.0.1',
  port: 2222,
  username: 'centos',
  password: 'centos',
  remotePath: '/home/centos/e2e-test-workspace',
};