import * as vscode from 'vscode';

/**
 * Lightweight status bar progress manager.
 * - Ref-counted tasks
 * - Spinner while any task is running
 * - Optional short messages (e.g., "123/2137")
 */
export class ProgressService {
  private item: vscode.StatusBarItem;
  private active = new Map<string, { label: string; message?: string }>();

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'LiveSync Progress';
    this.item.command = 'livesync.focusExperimentalView'; // optional command
    this.refresh();
    this.item.show(); // keep visible but empty; hide if you prefer
  }

  start(taskId: string, label: string): void {
    this.active.set(taskId, { label });
    this.refresh();
  }

  report(taskId: string, message: string): void {
    const current = this.active.get(taskId);
    if (current) {
      current.message = message;
      this.refresh();
    }
  }

  done(taskId: string): void {
    this.active.delete(taskId);
    this.refresh();
  }

  async withTask<T>(
    label: string,
    task: (report: (msg: string) => void) => Promise<T>
  ): Promise<T> {
    const taskId = `${label}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    this.start(taskId, label);
    try {
      const result = await task((msg) => this.report(taskId, msg));
      return result;
    } finally {
      this.done(taskId);
    }
  }

  dispose(): void {
    this.item.dispose();
    this.active.clear();
  }

  private refresh(): void {
    if (this.active.size === 0) {
      this.item.text = 'LiveSync';
      this.item.tooltip = 'LiveSync ready';
      return;
    }
    // If multiple tasks, show the first’s label + count
    const [firstId, first] = this.active.entries().next().value as [string, { label: string; message?: string }];
    const suffix = this.active.size > 1 ? ` (+${this.active.size - 1})` : '';
    const msg = first.message ? ` — ${first.message}` : '';
    this.item.text = `$(sync~spin) LiveSync: ${first.label}${suffix}${msg}`;
    this.item.tooltip = `${first.label}${msg}`;
  }
}
