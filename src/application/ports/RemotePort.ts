import type { FileMeta } from '@domain/types';

/**
 * Abstraction over your real remote.
 * Implement this against your current backend (HTTP, WebDAV, S3, etc.).
 */
export interface RemotePort {
  /** Get a full remote index (path -> FileMeta). */
  list(workspaceId: string): Promise<Map<string, FileMeta>>;

  /** Upload (create/overwrite) a file from local disk to remote. */
  uploadFile(workspaceId: string, relativePath: string, absoluteLocalPath: string): Promise<void>;

  /** Delete a file or an entire directory subtree on remote. */
  deletePath(workspaceId: string, relativePath: string): Promise<void>;

  /** Download a file from remote to local disk (overwrite if exists). */
  downloadFile(workspaceId: string, relativePath: string, absoluteLocalPath: string): Promise<void>;
}
