// src/application/ports/NullRemotePort.ts
import type { RemotePort } from './RemotePort';
import type { WorkspaceId, RelPath, NodeIndex } from '@domain/types';

export class RemoteNotConfiguredError extends Error {
  constructor(public readonly workspaceId: WorkspaceId) {
    super(`Remote not configured for workspace: ${workspaceId as unknown as string}`);
    this.name = 'RemoteNotConfiguredError';
  }
}

export class NullRemotePort implements RemotePort {
  async list(workspaceId: WorkspaceId): Promise<NodeIndex> {
    throw new RemoteNotConfiguredError(workspaceId);
  }
  async uploadFile(workspaceId: WorkspaceId, _rel: RelPath, _absLocal: string): Promise<void> {
    throw new RemoteNotConfiguredError(workspaceId);
  }
  async deletePath(workspaceId: WorkspaceId, _rel: RelPath): Promise<void> {
    throw new RemoteNotConfiguredError(workspaceId);
  }
  async downloadFile(workspaceId: WorkspaceId, _rel: RelPath, _absLocal: string): Promise<void> {
    throw new RemoteNotConfiguredError(workspaceId);
  }
}
