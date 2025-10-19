
export enum ExecutionMode {
  Single, // drop duplicates
  Queue,  // FIFO queue
}

/**
 * Pair a command‐callback with its desired execution mode.
 */
export interface CommandEntry {
  callback: (...args: any[]) => Promise<any> | void;
  mode: ExecutionMode;
}


export class CommandManager {
  /** Tracks which commandKeys are currently executing */
  private static running = new Set<string>();

  /** FIFO queues for commands that want to preserve every invocation */
  private static queues = new Map<string, any[][]>();

  public static async singleExecution(
    commandKey: string,
    command: (...args: any[]) => Promise<any> | void,
    args: any[]
  ) {
    if (this.running.has(commandKey)) {
      console.info(`"${commandKey}" already running; dropping duplicate.`);
      return;
    }
    this.running.add(commandKey);
    try {
      return await command(...args);
    } finally {
      this.running.delete(commandKey);
    }
  }

  public static async queueExecution(
    commandKey: string,
    command: (...args: any[]) => Promise<any> | void,
    args: any[]
  ) {
    if (!this.queues.has(commandKey)) {
      this.queues.set(commandKey, []);
    }
    this.queues.get(commandKey)!.push(args);

    if (this.running.has(commandKey)) {
      // Already draining one loop—new args will be picked up there.
      return;
    }

    this.running.add(commandKey);
    try {
      const queue = this.queues.get(commandKey)!;
      while (queue.length) {
        const nextArgs = queue.shift()!;
        try {
          await command(...nextArgs);
        } catch (err) {
          console.error(`Error in queued "${commandKey}":`, err);
        }
      }
    } finally {
      this.running.delete(commandKey);
    }
  }
}
