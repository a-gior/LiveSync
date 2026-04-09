import { logExpectedError } from '@helpers/logging';

export type OperationType = 'create' | 'save' | 'open' | 'delete' | 'move';

interface OperationMetadata {
  type: OperationType;
  timestamp: number;
}

/**
 * Ensures file operations are serialized per file path.
 * Prevents race conditions when the same file is modified rapidly.
 * Tracks operation types to prevent conflicting events (e.g., create→open).
 */
export class FileOperationQueue {
  // Store Promise<void> instead of Promise<T> to avoid type conflicts
  private readonly queues = new Map<string, Promise<void>>();
  
  // Track currently running operations by type
  private readonly activeOperations = new Map<string, OperationType>();
  
  // Track recently completed operations to prevent event collisions
  private readonly recentOperations = new Map<string, OperationMetadata>();
  
  // TTL for recent operations (ms)
  private readonly RECENT_OP_TTL_MS = 1000;
  
  /**
   * Queue an operation for a specific file.
   * Operations for the same key are serialized; different keys run in parallel.
   * 
   * @param key - Unique identifier for the file (e.g., "workspaceId:relPath")
   * @param operation - The async operation to execute
   * @param operationType - Type of operation for conflict detection
   */
  async enqueue<T>(
    key: string,
    operationType: OperationType, 
    operation: () => Promise<T>
  ): Promise<T> {
    // Mark operation to prevent race conditions
    this.activeOperations.set(key, operationType);
    this.markRecentOperation(key, operationType); // Mark as recent
    
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
          return result;
        } catch (err) {
          logExpectedError(`FileOperationQueue:${key}`, err);
          reject!(err); // Reject the caller's promise
          throw err; // Re-throw to mark this queue slot as failed
        } finally {
          // Clear active status (operation completed)
          this.activeOperations.delete(key);
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
   * Mark an operation as recently completed
   */
  private markRecentOperation(key: string, operationType: OperationType): void {
    this.recentOperations.set(key, {
      type: operationType,
      timestamp: Date.now()
    });
    
    // Auto-cleanup after TTL
    setTimeout(() => {
      const entry = this.recentOperations.get(key);
      if (entry && Date.now() - entry.timestamp >= this.RECENT_OP_TTL_MS) {
        this.recentOperations.delete(key);
      }
    }, this.RECENT_OP_TTL_MS);
  }

  /**
   * Check if there's a recent operation that should block the current event
   * 
   * @param key - The operation key to check
   * @param withinMs - Time window to consider (default: RECENT_OP_TTL_MS)
   * @returns Operation metadata if found within time window
   */
  getRecentOperation(key: string, withinMs?: number): OperationMetadata | undefined {
    const entry = this.recentOperations.get(key);
    if (!entry) {
      return undefined;
    }
    
    const maxAge = withinMs ?? this.RECENT_OP_TTL_MS;
    const age = Date.now() - entry.timestamp;
    
    if (age > maxAge) {
      this.recentOperations.delete(key);
      return undefined;
    }
    
    return entry;
  }

  /**
   * Check if a specific operation type was recently completed
   * 
   * @param key - The operation key to check
   * @param operationType - The operation type to check for
   * @param withinMs - Time window to consider (default: RECENT_OP_TTL_MS)
   */
  hadRecentOperation(key: string, operationType: OperationType, withinMs?: number): boolean {
    const recent = this.getRecentOperation(key, withinMs);
    return recent?.type === operationType;
  }

  /**
   * Check if any of the specified operation types were recently completed
   * 
   * @param key - The operation key to check
   * @param operationTypes - Array of operation types to check for
   * @param withinMs - Time window to consider (default: RECENT_OP_TTL_MS)
   */
  hadRecentOperationAny(key: string, operationTypes: OperationType[], withinMs?: number): boolean {
    const recent = this.getRecentOperation(key, withinMs);
    if (!recent) {
      return false;
    }
    return operationTypes.includes(recent.type);
  }

  /**
   * Check if an operation type is CURRENTLY ACTIVE or was recently completed
   * This is the key method to prevent race conditions between events (e.g., create→open)
   * 
   * @param key - The operation key to check
   * @param operationType - The operation type to check for
   * @param withinMs - Time window for recent operations (default: RECENT_OP_TTL_MS)
   */
  isActiveOrRecent(key: string, operationType: OperationType, withinMs?: number): boolean {
    // Check if currently active
    const active = this.activeOperations.get(key);
    if (active === operationType) {
      return true;
    }
    
    // Check if recently completed
    return this.hadRecentOperation(key, operationType, withinMs);
  }

  /**
   * Check if ANY of the specified operation types are currently active or recently completed
   * This is the recommended method for conflict detection
   * 
   * @param key - The operation key to check
   * @param operationTypes - Array of operation types to check for
   * @param withinMs - Time window for recent operations (default: RECENT_OP_TTL_MS)
   */
  isActiveOrRecentAny(key: string, operationTypes: OperationType[], withinMs?: number): boolean {
    // Check if any are currently active
    const active = this.activeOperations.get(key);
    if (active && operationTypes.includes(active)) {
      return true;
    }
    
    // Check if any were recently completed
    return this.hadRecentOperationAny(key, operationTypes, withinMs);
  }

  /**
   * Check if a key has pending operations.
   */
  isPending(key: string): boolean {
    return this.queues.has(key);
  }
  
  /**
   * Get the currently active operation type for a key
   */
  getActiveOperation(key: string): OperationType | undefined {
    return this.activeOperations.get(key);
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
    this.activeOperations.clear();
    this.recentOperations.clear();
  }
}

/** Singleton instance shared across the extension */
export const fileOperationQueue = new FileOperationQueue();