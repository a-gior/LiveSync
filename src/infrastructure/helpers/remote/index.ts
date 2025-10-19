import type { WorkspaceId } from '@domain/types';
import { Services } from '../../../extension/services';

/** Refresh remote snapshot → state + optional cache (if provided in services). */
export async function refreshRemoteSnapshot(services: Services, workspaceId: WorkspaceId): Promise<void> {
  const newRemote = await services.remote.list(workspaceId);
  services.state.setRemoteIndex(workspaceId, newRemote);
  await services.remoteCache.save(workspaceId, newRemote);
}
