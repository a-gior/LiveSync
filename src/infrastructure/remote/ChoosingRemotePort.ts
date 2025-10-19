// src/extension/ChoosingRemotePort.ts
import type { RemotePort } from '@app/ports/RemotePort';
import { NullRemotePort } from '@app/ports/NullRemotePort';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { WorkspaceId } from '@domain/types';

export class ChoosingRemotePort implements RemotePort {
  private readonly none = new NullRemotePort();

  constructor(
    private readonly cfg: WorkspaceConfigService,
    private readonly sftp: RemotePort
  ) {}

  private async pick(workspaceId: WorkspaceId): Promise<RemotePort> {
    const eff = await this.cfg.getById(workspaceId);
    return eff.hasRemote ? this.sftp : this.none;
  }

  async list(workspaceId: WorkspaceId)                  { return (await this.pick(workspaceId)).list(workspaceId as any); }
  async uploadFile(w: WorkspaceId, r: any, a: string)   { return (await this.pick(w)).uploadFile(w as any, r, a); }
  async deletePath(w: WorkspaceId, r: any)              { return (await this.pick(w)).deletePath(w as any, r); }
  async downloadFile(w: WorkspaceId, r: any, a: string) { return (await this.pick(w)).downloadFile(w as any, r, a); }
}
