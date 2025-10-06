import type { DiffStatus, FileMeta } from '../../domain/types';
import type { RemotePort } from '../../application/ports/RemotePort';
import type { SyncStateManager } from '../../application/SyncStateManager';
import type { ActionPolicy } from '../../infrastructure/config/ActionPolicy';
import { canUpload, canDownload } from '../../infrastructure/config/ActionPolicy';

export async function maybeActByPolicyCore(
  state: Pick<SyncStateManager, 'getDiffEntry' | 'setRemoteIndex' | 'applyLocal'>,
  remote: RemotePort,
  workspaceId: string,
  relPath: string,
  policy: ActionPolicy,
  joinFs: (ws: string, rel: string) => string,
  sha1OfFile: (abs: string) => Promise<string>
): Promise<void> {
  if (!policy.direction && !policy.extras.size) {
    return;
  }

  const entry = state.getDiffEntry(workspaceId, relPath);
  const status: DiffStatus | undefined = entry?.status;

  if (policy.direction === 'upload') {
    const allowed = entry ? (policy.check ? canUpload(status!) : true) : true;
    if (allowed) {
      const abs = joinFs(workspaceId, relPath);
      await remote.uploadFile(workspaceId, relPath, abs);
      const newRemote = await remote.list(workspaceId);
      state.setRemoteIndex(workspaceId, newRemote as Map<string, FileMeta>);
    }
  } else if (policy.direction === 'download') {
    const allowed = entry ? (policy.check ? canDownload(status!) : true) : true;
    if (allowed) {
      const abs = joinFs(workspaceId, relPath);
      await remote.downloadFile(workspaceId, relPath, abs);
      const hash = await sha1OfFile(abs);
      state.applyLocal({ workspaceId, type: 'modify', path: relPath, meta: { type: 'file', hash } });
    }
  }
}
