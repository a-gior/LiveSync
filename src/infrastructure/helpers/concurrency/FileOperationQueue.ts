import { logExpectedError } from '@helpers/logging';

/**
 * Ensures file operations are serialized per file path.
 * Prevents race conditions when the same file is modified rapidly.
 */
export class FileOperationQueue {
  // Store Promise<void> instead of Promise<T> to avoid type conflicts
  private readonly queues = new Map<string, Promise<void>>();

  /**
   * Queue an operation for a specific file.
   * Operations for the same key are serialized; different keys run in parallel.
   */
  async enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    // Get the existing queue (or start with resolved promise)
    const existing = this.queues.get(key) ?? Promise.resolve();

    // Create a promise that resolves to T for the caller
    let resolve: (value: T) => void;
    let reject: (error: any) => void;
    const resultPromise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // Chain onto the existing queue, returning void for the internal chain
    const next = existing
      .then(async () => {
        try {
          const result = await operation();
          resolve!(result); // Resolve the caller's promise
        } catch (err) {
          logExpectedError(`FileOperationQueue:${key}`, err);
          reject!(err); // Reject the caller's promise
          throw err; // Re-throw to mark this queue slot as failed
        }
      })
      .catch(() => {
        // Swallow errors in the queue chain so it keeps processing
        // The caller already got the error via reject!()
      })
      .then(() => {
        // Clean up completed operations
        if (this.queues.get(key) === next) {
          this.queues.delete(key);
        }
      });

    // Store the void-returning chain
    this.queues.set(key, next);

    // Return the T-returning promise to the caller
    return resultPromise;
  }

  /**
   * Check if a key has pending operations.
   */
  isPending(key: string): boolean {
    return this.queues.has(key);
  }

  /**
   * Get count of active queues (for debugging/telemetry).
   */
  getActiveCount(): number {
    return this.queues.size;
  }

  /**
   * Clear all pending operations (use during shutdown).
   */
  clear(): void {
    this.queues.clear();
  }
}