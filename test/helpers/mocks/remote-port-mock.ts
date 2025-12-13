import type { RemotePort } from '../../../src/application/ports/RemotePort';
import type { WorkspaceId, RelPath, NodeIndex } from '../../../src/domain/types';

export class RemotePortMock implements RemotePort {
  private indexes: Map<WorkspaceId, NodeIndex> = new Map();
  
  public uploadedFiles: Array<{ workspaceId: WorkspaceId; relPath: RelPath }> = [];
  public downloadedFiles: Array<{ workspaceId: WorkspaceId; relPath: RelPath }> = [];
  public deletedPaths: Array<{ workspaceId: WorkspaceId; relPath: RelPath }> = [];

  setIndex(workspaceId: WorkspaceId, index: NodeIndex): void {
    this.indexes.set(workspaceId, index);
  }

  async list(workspaceId: WorkspaceId): Promise<NodeIndex> {
    return this.indexes.get(workspaceId) || new Map();
  }

  async uploadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    this.uploadedFiles.push({ workspaceId, relPath });
  }

  async uploadFolder(workspaceId: WorkspaceId, files: Array<{ relPath: RelPath; absLocal: string }>): Promise<RelPath[]> {
    return files.map(f => f.relPath);
  }

  async downloadFile(workspaceId: WorkspaceId, relPath: RelPath, absLocal: string): Promise<void> {
    this.downloadedFiles.push({ workspaceId, relPath });
  }

  async downloadFolder(workspaceId: WorkspaceId, files: Array<{ relPath: RelPath; absLocal: string }>): Promise<RelPath[]> {
    return files.map(f => f.relPath);
  }

  async deletePath(workspaceId: WorkspaceId, relPath: RelPath): Promise<void> {
    this.deletedPaths.push({ workspaceId, relPath });
  }

  async getFileHash(workspaceId: WorkspaceId, relPath: RelPath): Promise<string> {
    return 'mock-hash';
  }

  reset(): void {
    this.uploadedFiles = [];
    this.downloadedFiles = [];
    this.deletedPaths = [];
  }
}
