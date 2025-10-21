import * as vscode from 'vscode';
import { WorkspaceConfigService } from './WorkspaceConfigService';
import { WorkspaceId } from '@domain/types';
import { stringToWsId } from '@helpers/path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ConfigValidationResult {
  workspaceId: WorkspaceId;
  hasConfig: boolean;
  isValid: boolean;
  error?: string;
}

export interface ConnectionSettings {
  hostname: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: string;
}

export class ConfigValidator {
  constructor(private readonly configService: WorkspaceConfigService) {}

  /**
   * Test a connection with arbitrary settings (used by config panel)
   */
  static async testConnection(settings: ConnectionSettings): Promise<ConnectionTestResult> {
    // Validate required fields
    if (!settings.hostname) {
      return { success: false, message: 'Hostname is required' };
    }
    if (!settings.username) {
      return { success: false, message: 'Username is required' };
    }
    if (!settings.password && !settings.privateKeyPath) {
      return { success: false, message: 'Either password or private key is required' };
    }

    try {
      const { Client: SSHClient } = await import('ssh2');
      const client = new SSHClient();

      const result = await new Promise<ConnectionTestResult>((resolve) => {
        const timeout = setTimeout(() => {
          client.end();
          resolve({
            success: false,
            message: 'Connection timeout',
            details: 'SSH connection timed out after 8 seconds'
          });
        }, 8000);

        client
          .on('ready', () => {
            clearTimeout(timeout);
            client.end();
            resolve({
              success: true,
              message: 'Connection successful!',
              details: `Successfully connected to ${settings.hostname}:${settings.port}`
            });
          })
          .on('error', (err: Error) => {
            clearTimeout(timeout);
            client.end();
            
            let message = 'Connection failed';
            let details = err.message;

            // Provide helpful error messages
            if (err.message.includes('All configured authentication methods failed')) {
              message = 'Authentication failed';
              details = 'Username, password, or private key is incorrect';
            } else if (err.message.includes('Cannot parse privateKey')) {
              message = 'Invalid private key';
              details = 'The private key file is invalid or malformed';
            } else if (err.message.includes('Encrypted private key detected')) {
              message = 'Private key requires passphrase';
              details = 'Please provide the passphrase for your private key';
            } else if (err.message.includes('ENOTFOUND')) {
              message = 'Host not found';
              details = `Unable to resolve hostname: ${settings.hostname}`;
            } else if (err.message.includes('ECONNREFUSED')) {
              message = 'Connection refused';
              details = `Server at ${settings.hostname}:${settings.port} refused the connection`;
            } else if (err.message.includes('ETIMEDOUT')) {
              message = 'Connection timed out';
              details = `Unable to connect to ${settings.hostname}:${settings.port}`;
            }

            resolve({ success: false, message, details });
          });

        // Build connection config
        const config: any = {
          host: settings.hostname,
          port: settings.port,
          username: settings.username,
          readyTimeout: 8000,
          keepaliveInterval: 15000
        };

        // Add authentication
        if (settings.password) {
          config.password = settings.password;
        }

        if (settings.privateKeyPath) {
          try {
            const keyContent = this.readPrivateKey(settings.privateKeyPath);
            config.privateKey = Buffer.from(keyContent, 'utf8');
            
            if (settings.passphrase) {
              config.passphrase = settings.passphrase;
            }
          } catch (error: any) {
            clearTimeout(timeout);
            resolve({
              success: false,
              message: 'Private key error',
              details: error.message
            });
            return;
          }
        }

        client.connect(config);
      });

      return result;

    } catch (error: any) {
      return {
        success: false,
        message: 'Configuration error',
        details: error.message
      };
    }
  }

  /**
   * Read private key file (helper method)
   */
  private static readPrivateKey(keyPath: string): string {
    let resolvedPath = keyPath;
    
    if (keyPath.startsWith('~')) {
      resolvedPath = path.join(os.homedir(), keyPath.slice(1));
    }
    
    resolvedPath = path.resolve(resolvedPath);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Private key file not found: ${resolvedPath}`);
    }
    
    return fs.readFileSync(resolvedPath, 'utf8');
  }

  /**
   * Validate a workspace configuration (check if config exists and SFTP is reachable).
   */
  async validate(folder: vscode.WorkspaceFolder): Promise<ConfigValidationResult> {
    const workspaceId = stringToWsId(folder.uri.fsPath);
    
    try {
      const eff = await this.configService.get(folder);
      
      if(Object.keys(eff.data).length === 0) {
        return {
            workspaceId,
            hasConfig: false,
            isValid: false,
            error: 'No LiveSync configuration found'
        };
      }
      
      if (!eff.hasRemote) {
        return {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: 'No remote configuration found'
        };
      }

      // Test connection using the static method
      const testResult = await ConfigValidator.testConnection({
        hostname: eff.data.hostname!,
        port: eff.data.port ?? 22,
        username: eff.data.username!,
        password: eff.data.password,
        privateKeyPath: eff.data.privateKeyPath,
        passphrase: eff.data.passphrase
      });

      if (!testResult.success) {
        return {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: testResult.details || testResult.message
        };
      }

      return {
        workspaceId,
        hasConfig: true,
        isValid: true
      };

    } catch (err: any) {
      return {
        workspaceId,
        hasConfig: false,
        isValid: false,
        error: err.message
      };
    }
  }

  /**
   * Validate all workspace folders.
   */
  async validateAll(): Promise<ConfigValidationResult[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return Promise.all(folders.map(f => this.validate(f)));
  }
}