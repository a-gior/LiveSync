import type { WorkspaceId, RelPath, NodeIndex } from '@domain/types';

export interface RemotePort {
  /** List remote nodes (files + folders). Keys MUST be RelPath. */
  list(workspaceId: WorkspaceId): Promise<NodeIndex>;

  /** Upload a single file at RelPath from an absolute local path. */
  uploadFile(workspaceId: WorkspaceId, relativePath: RelPath, absoluteLocalPath: string): Promise<void>;

  /** Delete a file or folder subtree at RelPath (recursive for folders). */
  deletePath(workspaceId: WorkspaceId, relativePath: RelPath): Promise<void>;

  /** Download a single file at RelPath to an absolute local path. */
  downloadFile(workspaceId: WorkspaceId, relativePath: RelPath, absoluteLocalPath: string): Promise<void>;
}
