import type { WorkspaceConfigData } from '../../../src/infrastructure/config/WorkspaceConfig';

export class ConfigBuilder {
  private config: Partial<WorkspaceConfigData> = {};

  withHostname(hostname: string): this {
    this.config.hostname = hostname;
    return this;
  }

  withPort(port: number): this {
    this.config.port = port;
    return this;
  }

  withCredentials(username: string, password: string): this {
    this.config.username = username;
    this.config.password = password;
    return this;
  }

  withPrivateKey(path: string, passphrase?: string): this {
    this.config.privateKeyPath = path;
    this.config.passphrase = passphrase || '';
    return this;
  }

  withRemotePath(path: string): this {
    this.config.remotePath = path;
    return this;
  }

  withIgnoreList(patterns: string[]): this {
    this.config.ignoreList = patterns;
    return this;
  }

  build(): WorkspaceConfigData {
    return this.config as WorkspaceConfigData;
  }
}
