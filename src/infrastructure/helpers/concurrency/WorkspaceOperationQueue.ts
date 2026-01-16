/**
 * Workspace-level operation queue
 * 
 * Serializes operations per workspace to prevent concurrent index modifications.
 * Unlike FileOperationQueue (per-file), this handles workspace-wide operations
 * like full index refreshes.
 */

import { WorkspaceId } from '@domain/types';
import { logExpectedError } from '@helpers/logging';

export class WorkspaceOperationQueue {
  private readonly queues = new Map<WorkspaceId, Promise<void>>();
  private readonly activeOperations = new Map<WorkspaceId, string>();

  /**
   * Queue a workspace-level operation.
   * Operations for the same workspace are serialized.
   */
  async enqueue<T>(
    workspaceId: WorkspaceId,
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    this.activeOperations.set(workspaceId, operationName);

    const existing = this.queues.get(workspaceId) ?? Promise.resolve();

    let resolve: (value: T) => void;
    let reject: (error: unknown) => void;
    const resultPromise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const next = existing
      .then(async () => {
        try {
          const result = await operation();
          resolve!(result);
        } catch (err) {
          logExpectedError(`WorkspaceOperationQueue:${operationName}`, err);
          reject!(err);
          throw err;
        } finally {
          this.activeOperations.delete(workspaceId);
        }
      })
      .catch(() => {
        // Swallow to keep chain processing
      })
      .then(() => {
        if (this.queues.get(workspaceId) === next) {
          this.queues.delete(workspaceId);
        }
      });

    this.queues.set(workspaceId, next);
    return resultPromise;
  }

  /**
   * Check if workspace has pending operation
   */
  isPending(workspaceId: WorkspaceId): boolean {
    return this.queues.has(workspaceId);
  }

  /**
   * Get currently active operation name
   */
  getActiveOperation(workspaceId: WorkspaceId): string | undefined {
    return this.activeOperations.get(workspaceId);
  }

  /**
   * Clear all queues (for shutdown)
   */
  clear(): void {
    this.queues.clear();
    this.activeOperations.clear();
  }
}

/** Singleton instance */
export const workspaceOperationQueue = new WorkspaceOperationQueue();