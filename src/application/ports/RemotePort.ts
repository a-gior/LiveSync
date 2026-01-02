import type { WorkspaceId, RelPath, NodeIndex } from '@domain/types';

export interface RemotePort {
  /** List remote nodes (files + folders). Keys MUST be RelPath. */
  list(workspaceId: WorkspaceId): Promise<NodeIndex>;

  /** Upload a single file at RelPath from an absolute local path. */
  uploadFile(workspaceId: WorkspaceId, relativePath: RelPath, absoluteLocalPath: string): Promise<void>;

  /** Upload multiple files concurrently. Returns successfully uploaded RelPaths. */
  uploadFolder(
    workspaceId: WorkspaceId,
    files: Array<{ relPath: RelPath; absLocal: string }>
  ): Promise<RelPath[]>;

  /** Download a single file at RelPath to an absolute local path. */
  downloadFile(workspaceId: WorkspaceId, relativePath: RelPath, absoluteLocalPath: string): Promise<void>;

  /** Download multiple files concurrently. Returns successfully downloaded RelPaths. */
  downloadFolder(
    workspaceId: WorkspaceId,
    files: Array<{ relPath: RelPath; absLocal: string }>
  ): Promise<RelPath[]>;

  /** Rename/move a file or folder on remote (atomic operation) */
  move(
    workspaceId: WorkspaceId, 
    oldPath: RelPath, 
    newPath: RelPath
  ): Promise<void>;

  /** Delete a file or folder subtree at RelPath (recursive for folders). */
  deletePath(workspaceId: WorkspaceId, relativePath: RelPath): Promise<void>;

  /** Get hash of a single remote file without downloading it */
  getFileHash(workspaceId: WorkspaceId, relPath: RelPath): Promise<string>;
}