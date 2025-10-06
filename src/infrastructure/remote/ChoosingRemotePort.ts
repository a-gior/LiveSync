import type { RemotePort } from '../../application/ports/RemotePort';
import type { FileMeta } from '../../domain/types';
import { WorkspaceConfigService } from '../config/WorkspaceConfigService';

export class ChoosingRemotePort implements RemotePort {
  constructor(
    private readonly cfg: WorkspaceConfigService,
    private readonly sftp: RemotePort,
    private readonly fallback: RemotePort
  ) {}

  private async pick(workspaceId: string): Promise<RemotePort> {
    const eff = await this.cfg.getById(workspaceId);
    return eff.hasRemote ? this.sftp : this.fallback;
  }

  async list(workspaceId: string): Promise<Map<string, FileMeta>> {
    return (await this.pick(workspaceId)).list(workspaceId);
  }
  async uploadFile(workspaceId: string, relativePath: string, absoluteLocalPath: string): Promise<void> {
    return (await this.pick(workspaceId)).uploadFile(workspaceId, relativePath, absoluteLocalPath);
  }
  async deletePath(workspaceId: string, relativePath: string): Promise<void> {
    return (await this.pick(workspaceId)).deletePath(workspaceId, relativePath);
  }
  async downloadFile(workspaceId: string, relativePath: string, absoluteLocalPath: string): Promise<void> {
    return (await this.pick(workspaceId)).downloadFile(workspaceId, relativePath, absoluteLocalPath);
  }
}
