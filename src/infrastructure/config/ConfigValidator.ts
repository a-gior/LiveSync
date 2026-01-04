import * as vscode from 'vscode';
import { WorkspaceConfigService } from './WorkspaceConfigService';
import { WorkspaceId } from '@domain/types';
import { stringToWsId } from '@helpers/path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

export interface ConfigValidationResult {
  workspaceId: WorkspaceId;
  hasConfig: boolean;
  isValid: boolean;
  error?: string;
}

export interface ConnectionSettings {
  hostname: string;
  port?: number;
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

/**
 * Tracks validation state changes and determines when auto-refresh should occur
 */
export class ConfigValidationTracker {
  private previousState = new Map<WorkspaceId, { hasConfig: boolean; isValid: boolean, ignoreGlobs: readonly string[] }>();

  /**
   * Update state and determine if auto-refresh should be triggered
   * 
   * @returns true if config just became valid (either new config or fixed invalid config)
   */
  updateAndCheckRefresh(result: ConfigValidationResult, currentIgnoreGlobs: readonly string[]): boolean {
    const previous = this.previousState.get(result.workspaceId);
    
    // Update state
    this.previousState.set(result.workspaceId, {
      hasConfig: result.hasConfig,
      isValid: result.isValid,
      ignoreGlobs: currentIgnoreGlobs
    });
    
    // No previous state - don't refresh (initial load)
    if (!previous) {
      return false;
    }
    
    // Config is not valid now - don't refresh
    if (!result.isValid || !result.hasConfig) {
      return false;
    }
    
    // No config before, now has valid config (new setup)
    if (!previous.hasConfig && result.hasConfig && result.isValid) {
      return true;
    }
    
    // Had config but was invalid, now valid (fixed config)
    if (previous.hasConfig && !previous.isValid && result.isValid) {
      return true;
    }
    
    // Config is valid and ignore patterns changed
    const ignoreChanged = previous.ignoreGlobs.length !== currentIgnoreGlobs.length || previous.ignoreGlobs.some((pattern, i) => pattern !== currentIgnoreGlobs[i]);
    if(ignoreChanged) {
      return true;
    }

    return false;
  }

  /**
   * Initialize tracking state (call after initial validation)
   */
  initialize(results: ConfigValidationResult[], configService: WorkspaceConfigService): void {
    for (const result of results) {
      if(!vscode.workspace.workspaceFolders) { continue; }
      
      // Get ignore globs synchronously from config service
      const cfg = configService.getSync(
        vscode.workspace.workspaceFolders?.find(
          f => stringToWsId(f.uri.fsPath) === result.workspaceId
        ) ?? vscode.workspace.workspaceFolders[0]
      );
      
      this.previousState.set(result.workspaceId, {
        hasConfig: result.hasConfig,
        isValid: result.isValid,
        ignoreGlobs: cfg?.ignoreFilter.globs ?? []
      });
    }
  }
}

export class ConfigValidator {
  private readonly tracker = new ConfigValidationTracker();
  private readonly validationCache = new Map<WorkspaceId, ConfigValidationResult>();

  constructor(private readonly configService: WorkspaceConfigService) {}

  /**
   * Get the validation tracker for monitoring state changes
   */
  getTracker(): ConfigValidationTracker {
    return this.tracker;
  }

  /**
   * Get cached validation result, or return invalid if not cached
   */
  getCached(workspaceId: WorkspaceId): ConfigValidationResult {
    const cached = this.validationCache.get(workspaceId);
    if (cached) {
      return cached;
    }
    
    // Not validated yet - return invalid
    return {
      workspaceId,
      hasConfig: false,
      isValid: false,
      error: 'Configuration not yet validated'
    };
  }

  /**
   * Clear cache for a workspace (call when config changes)
   */
  clearCache(workspaceId: WorkspaceId): void {
    this.validationCache.delete(workspaceId);
  }

  /**
   * Check if workspace has valid config (from cache)
   */
  isValid(workspaceId: WorkspaceId): boolean {
    return this.getCached(workspaceId).isValid;
  }

  /**
   * Get validation error message (from cache)
   */
  getError(workspaceId: WorkspaceId): string | undefined {
    return this.getCached(workspaceId).error;
  }

  /**
   * Validate all workspace configurations
   * 
   * @param testConnection - If true, performs full SSH authentication tests (slow, 5-8s per host)
   * @param quickReachability - If true, performs quick TCP reachability check (fast, 2s per host)
   */
  async validateAll(testConnection: boolean = false, quickReachability: boolean = false): Promise<ConfigValidationResult[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const results: ConfigValidationResult[] = [];

    for (const folder of folders) {
      const result = await this.validate(folder, testConnection, quickReachability);
      results.push(result);
    }

    return results;
  }

  /**
   * Validate a single workspace configuration
   * 
   * @param folder - The workspace folder to validate
   * @param testConnection - If true, performs full SSH authentication test (slow but thorough)
   * @param quickReachability - If true, performs quick host reachability check (fast, 2s timeout)
   */
  async validate(
    folder: vscode.WorkspaceFolder, 
    testConnection: boolean = false,
    quickReachability: boolean = false
  ): Promise<ConfigValidationResult> {
    const workspaceId = stringToWsId(folder.uri.fsPath);
    const configPath = path.join(folder.uri.fsPath, '.vscode', 'livesync.json');

    let result: ConfigValidationResult;

    // Check if config file exists
    try {
      await fs.promises.access(configPath, fs.constants.F_OK);
    } catch {
      result = {
        workspaceId,
        hasConfig: false,
        isValid: false,
        error: 'No configuration file found'
      };
      this.validationCache.set(workspaceId, result);
      return result;
    }

    // Try to load and validate config
    try {
      const config = await this.configService.get(folder);

      // Basic validation: needs hostname and remotePath for remote sync
      if (!config.data.hostname || !config.data.remotePath) {
        result = {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: 'Missing required fields (hostname or remotePath)'
        };
      }
      // Needs authentication
      else if (!config.data.password && !config.data.privateKeyPath) {
        result = {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: 'Missing authentication (password or privateKeyPath)'
        };
      }
      // Quick reachability check (fast - just TCP connect)
      else if (quickReachability && !await ConfigValidator.quickReachabilityTest(config.data.hostname, config.data.port || 22)) {
        result = {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: `Host unreachable: ${config.data.hostname}:${config.data.port || 22}`
        };
      }
      // Full connection test (slow - full SSH handshake + auth)
      else if (testConnection) {
        const connectionTest = await ConfigValidator.testConnection({
          hostname: config.data.hostname,
          port: config.data.port || 22,
          username: config.data.username || '',
          password: config.data.password,
          privateKeyPath: config.data.privateKeyPath,
          passphrase: config.data.passphrase,
        });

        result = connectionTest.success
          ? { workspaceId, hasConfig: true, isValid: true }
          : { workspaceId, hasConfig: true, isValid: false, error: `Connection failed: ${connectionTest.message}` };
      }
      // All checks passed
      else {
        result = { workspaceId, hasConfig: true, isValid: true };
      }
    } catch (err) {
      result = {
        workspaceId,
        hasConfig: true,
        isValid: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }

    // Cache and return
    this.validationCache.set(workspaceId, result);
    return result;
  }

  /**
   * Quick reachability test - just checks if host is reachable on the port
   * Much faster than full SSH handshake (1-2 seconds vs 5-8 seconds)
   */
  static async quickReachabilityTest(hostname: string, port: number = 22): Promise<boolean> {
    return new Promise(resolve => {
      const sock = new net.Socket();
      sock.setTimeout(2000);
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("timeout", () => { sock.destroy(); resolve(false); });
      sock.once("error", () => { sock.destroy(); resolve(false); });
      sock.connect(port, hostname);
    });
  }

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
              details: 'Successfully connected to the remote server'
            });
          })
          .on('error', (err: Error) => {
            clearTimeout(timeout);
            client.end();
            resolve({
              success: false,
              message: 'Connection failed',
              details: err.message
            });
          });

        // Build connection config
        const config: any = {
          host: settings.hostname,
          port: settings.port || 22,
          username: settings.username,
          readyTimeout: 7000,
        };

        if (settings.password) {
          config.password = settings.password;
        } else if (settings.privateKeyPath) {
          try {
            const expandedPath = settings.privateKeyPath.replace(/^~/, os.homedir());
            const privateKey = fs.readFileSync(expandedPath, 'utf8');
            config.privateKey = privateKey;
            if (settings.passphrase) {
              config.passphrase = settings.passphrase;
            }
          } catch (err) {
            clearTimeout(timeout);
            client.end();
            resolve({
              success: false,
              message: 'Failed to read private key',
              details: err instanceof Error ? err.message : 'Unknown error'
            });
            return;
          }
        }

        client.connect(config);
      });

      return result;
    } catch (err) {
      return {
        success: false,
        message: 'Connection test failed',
        details: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }
}