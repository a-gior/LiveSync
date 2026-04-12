// File: src/infrastructure/config/ConfigValidator.ts
// COMPLETE REPLACEMENT - Event-Driven Version

import * as vscode from 'vscode';
import { WorkspaceConfigService } from './WorkspaceConfigService';
import { WorkspaceId } from '@domain/types';
import { stringToWsId } from '@helpers/path';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { findWorkspaceFolderById } from '../helpers/workspaceFolder';
import { isNetworkError } from '../helpers/config';
import { getProxyConfig, createProxySocket } from '../helpers/proxy/createProxySocket';

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
 * Event emitted when validation state changes
 */
export interface ValidationChangedEvent {
  workspaceId: WorkspaceId;
  result: ConfigValidationResult;
  hostname?: string;
  remotePath?: string;
  label?: string;
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
    
    const ignoreChanged = previous.ignoreGlobs.length !== currentIgnoreGlobs.length || 
                          previous.ignoreGlobs.some((pattern, i) => pattern !== currentIgnoreGlobs[i]);
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
        findWorkspaceFolderById(result.workspaceId) ?? vscode.workspace.workspaceFolders[0]
      );
      
      this.previousState.set(result.workspaceId, {
        hasConfig: result.hasConfig,
        isValid: result.isValid,
        ignoreGlobs: cfg?.ignoreFilter.globs ?? []
      });
    }
  }
}

/**
 * ConfigValidator with event-driven architecture
 * Emits 'validationChanged' events when validation state changes
 */
export class ConfigValidator {
  private readonly tracker = new ConfigValidationTracker();
  private readonly validationCache = new Map<WorkspaceId, ConfigValidationResult>();
  private readonly eventEmitter = new vscode.EventEmitter<ValidationChangedEvent>();
  
  // Public event for subscribers
  readonly onValidationChanged = this.eventEmitter.event;

  constructor(private readonly configService: WorkspaceConfigService) {}

  /**
   * Get the validation tracker for monitoring state changes
   */
  getTracker(): ConfigValidationTracker {
    return this.tracker;
  }

  /**
   * Get cached validation result with optional auto-revalidation and user prompts
   * 
   * @param workspaceId - Workspace to validate
   * @param options - Configuration options
   * @returns Validation result (after optional revalidation and prompts)
   */
  async getCached(
    workspaceId: WorkspaceId,
    showPrompt: boolean = true              // Show error dialogs (default: false)
  ): Promise<ConfigValidationResult> {
    let cached = this.validationCache.get(workspaceId);
    
    // No cache - return invalid
    if (!cached) {
      cached = {
        workspaceId,
        hasConfig: false,
        isValid: false,
        error: 'Configuration not yet validated'
      };
    }
    
    // Valid - return immediately
    if (cached.isValid) {
      return cached;
    }
    
    // Auto-revalidate stale network errors
    const folder = findWorkspaceFolderById(workspaceId);
    if (isNetworkError(cached.error)) {
      if (folder) {
        const fresh = await this.validate(folder, false, true);
        cached = fresh; // Use fresh result
      }
    }
    
    // Show user prompts if requested
    if (showPrompt && folder && !cached.isValid) {
      await this.showValidationPrompt(cached, folder);
    }
    
    return cached;
  }

  /**
   * Show appropriate error prompt based on validation result
   */
  private async showValidationPrompt(
    result: ConfigValidationResult,
    folder: vscode.WorkspaceFolder
  ): Promise<void> {
    if (!result.hasConfig) {
      const choice = await vscode.window.showWarningMessage(
        `Cannot access ${folder.name}: No remote configuration found`,
        'Configure'
      );
      if (choice === 'Configure') {
        await vscode.commands.executeCommand('livesync.configuration', { folder });
      }
    } else {
      const errorMsg = result.error || 'Invalid configuration';
      const choice = await vscode.window.showErrorMessage(
        `Cannot access ${folder.name}: ${errorMsg}`,
        'Fix Configuration'
      );
      if (choice === 'Fix Configuration') {
        await vscode.commands.executeCommand('livesync.configuration', { folder });
      }
    }
  }

  /**
   * Clear cache for a workspace (does NOT emit event - use invalidate() for that)
   */
  clearCache(workspaceId: WorkspaceId): void {
    this.validationCache.delete(workspaceId);
  }

  /**
   * Check if workspace has valid config (from cache)
   */
  async isValid(workspaceId: WorkspaceId): Promise<boolean> {
    return (await this.getCached(workspaceId)).isValid;
  }

  async getError(workspaceId: WorkspaceId): Promise<string | undefined> {
    return (await this.getCached(workspaceId)).error;
  }

  /**
   * Mark workspace as invalid due to an error (typically connection error)
   * Emits validationChanged event to update UI
   * 
   * Call this from catch blocks when remote operations fail
   */
  async invalidate(workspaceId: WorkspaceId, error: Error | string): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : error;
    
    // Check if this is actually a network/connection error
    if (!isNetworkError(errorMsg)) {
      // Not a connection error - don't invalidate cache
      return;
    }
    
    
    const folder = findWorkspaceFolderById(workspaceId);
    if (!folder) {
      return;
    }
    
    // Get current config for metadata
    let hostname: string | undefined;
    let remotePath: string | undefined;
    
    try {
      const cfg = await this.configService.get(folder);
      hostname = cfg.data.hostname;
      remotePath = cfg.data.remotePath;
    } catch {
      // Ignore
    }
    
    const result: ConfigValidationResult = {
      workspaceId,
      hasConfig: true,
      isValid: false,
      error: errorMsg
    };
    
    // Update cache
    this.validationCache.set(workspaceId, result);
    
    // Emit event
    this.eventEmitter.fire({
      workspaceId,
      result,
      hostname,
      remotePath,
      label: folder.name
    });
  }

  async validateAll(testConnection: boolean = false, quickReachability: boolean = false): Promise<ConfigValidationResult[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const results: ConfigValidationResult[] = [];

    for (const folder of folders) {
      const result = await this.validate(folder, testConnection, quickReachability);
      results.push(result);
    }

    return results;
  }

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
      
      // ONLY update cache and emit ONCE at the end
      this.updateCacheAndEmit(workspaceId, result, folder.name);
      return result;
    }

    // Try to load and validate config
    try {
      const config = await this.configService.get(folder);

      if (!config.data.hostname || !config.data.remotePath) {
        result = {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: 'Missing required fields (hostname or remotePath)'
        };
      }
      else if (!config.data.password && !config.data.privateKeyPath) {
        result = {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: 'Missing authentication (password or privateKeyPath)'
        };
      }
      else if (quickReachability && !await ConfigValidator.quickReachabilityTest(config.data.hostname, config.data.port || 22)) {
        result = {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: `Host unreachable: ${config.data.hostname}:${config.data.port || 22}`
        };
      }
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

    // SINGLE point of cache update + event emission
    this.updateCacheAndEmit(workspaceId, result, folder.name);
    return result;
  }

  /**
   * Update cache and emit event (single source of truth)
   */
  private async updateCacheAndEmit(
    workspaceId: WorkspaceId,
    result: ConfigValidationResult,
    label?: string
  ): Promise<void> {
    this.validationCache.set(workspaceId, result);
    await this.emitValidationChanged(workspaceId, result, label);
  }

  /**
   * Emit validationChanged event with full metadata
   */
  private async emitValidationChanged(
    workspaceId: WorkspaceId, 
    result: ConfigValidationResult,
    label?: string
  ): Promise<void> {
    let hostname: string | undefined;
    let remotePath: string | undefined;
    
    if (result.isValid) {
      try {
        
        const folder = findWorkspaceFolderById(workspaceId);
        if (folder) {
          const cfg = await this.configService.get(folder);
          hostname = cfg.data.hostname;
          remotePath = cfg.data.remotePath;
        }
      } catch {
        // Ignore
      }
    }
    
    this.eventEmitter.fire({
      workspaceId,
      result,
      hostname,
      remotePath,
      label
    });
  }

  static async quickReachabilityTest(hostname: string, port: number = 22): Promise<boolean> {
    const proxy = getProxyConfig();

    if (proxy) {
      try {
        const sock = await createProxySocket(hostname, port, proxy);
        sock.destroy();
        return true;
      } catch {
        return false;
      }
    }

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
   * Test a connection
   */
  static async testConnection(settings: ConnectionSettings): Promise<ConnectionTestResult> {
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

        const proxy = getProxyConfig();
        if (proxy) {
          createProxySocket(settings.hostname!, settings.port || 22, proxy)
            .then((sock) => {
              config.sock = sock;
              client.connect(config);
            })
            .catch((err) => {
              clearTimeout(timeout);
              client.end();
              resolve({
                success: false,
                message: 'Proxy connection failed',
                details: err instanceof Error ? err.message : 'Unknown error',
              });
            });
        } else {
          client.connect(config);
        }
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

  dispose(): void {
    this.eventEmitter.dispose();
  }
}