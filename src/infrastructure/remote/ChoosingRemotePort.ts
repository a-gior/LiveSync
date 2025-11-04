// src/extension/ChoosingRemotePort.ts
import type { RemotePort } from '@app/ports/RemotePort';
import { NullRemotePort } from '@app/ports/NullRemotePort';
import { WorkspaceConfigService } from '@infra/config/WorkspaceConfigService';
import { WorkspaceId, RelPath } from '@domain/types';

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

  async list(workspaceId: WorkspaceId) { 
    return (await this.pick(workspaceId)).list(workspaceId); 
  }

  async uploadFile(w: WorkspaceId, r: RelPath, a: string) { 
    return (await this.pick(w)).uploadFile(w, r, a); 
  }

  async uploadFolder(w: WorkspaceId, files: Array<{ relPath: RelPath; absLocal: string }>) { 
    return (await this.pick(w)).uploadFolder(w, files); 
  }

  async downloadFile(w: WorkspaceId, r: RelPath, a: string) { 
    return (await this.pick(w)).downloadFile(w, r, a); 
  }

  async downloadFolder(w: WorkspaceId, files: Array<{ relPath: RelPath; absLocal: string }>) { 
    return (await this.pick(w)).downloadFolder(w, files); 
  }

  async deletePath(w: WorkspaceId, r: RelPath) { 
    return (await this.pick(w)).deletePath(w, r); 
  }
  
  async getFileHash(w: WorkspaceId, r: RelPath) { 
    return (await this.pick(w)).getFileHash(w, r); 
  }
}