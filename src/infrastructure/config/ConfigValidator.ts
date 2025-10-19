import * as vscode from 'vscode';
import { WorkspaceConfigService } from './WorkspaceConfigService';
import { WorkspaceId } from '@domain/types';
import { stringToWsId } from '@helpers/path';

export interface ConfigValidationResult {
  workspaceId: WorkspaceId;
  hasConfig: boolean;
  isValid: boolean;
  error?: string;
}

export class ConfigValidator {
  constructor(private readonly configService: WorkspaceConfigService) {}

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

      // Test SFTP connection
      const { Client: SSHClient } = await import('ssh2');
      const client = new SSHClient();

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          client.end();
          resolve(false);
        }, 5000); // 5 second timeout

        client
          .on('ready', () => {
            clearTimeout(timeout);
            client.end();
            resolve(true);
          })
          .on('error', () => {
            clearTimeout(timeout);
            resolve(false);
          })
          .connect({
            host: eff.data.hostname!,
            port: eff.data.port ?? 22,
            username: eff.data.username,
            password: eff.data.password,
            readyTimeout: 5000,
          });
      });

      if (!connected) {
        return {
          workspaceId,
          hasConfig: true,
          isValid: false,
          error: `Cannot reach ${eff.data.hostname}:${eff.data.port ?? 22}`
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