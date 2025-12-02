import * as vscode from 'vscode';

export class ProgressService {
  private item: vscode.StatusBarItem;
  private active = new Map<string, { label: string; message?: string }>();
  private remoteHint?: string;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'LiveSync Progress';
    // No command - just shows progress
    this.refresh();
    this.item.show();
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

  setRemoteHint(hint: string | undefined): void {
    const trimmed = hint?.trim();
    this.remoteHint = trimmed ? trimmed : undefined;
    this.refresh();
  }

  async withTask<T>(
    label: string,
    task: (report: (msg: string) => void) => Promise<T>
  ): Promise<T> {
    const id = `${label}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    this.start(id, label);
    try {
      return await task((msg) => this.report(id, msg));
    } finally {
      this.done(id);
    }
  }

  dispose(): void {
    this.item.dispose();
    this.active.clear();
  }

  private refresh(): void {
    if (this.active.size === 0) {
      this.item.hide();
      return;
    }

    const [, first] = this.active.entries().next().value as [string, { label: string; message?: string }];
    const suffix = this.active.size > 1 ? ` (+${this.active.size - 1})` : '';
    const msg = first.message ? ` — ${first.message}` : '';
    this.item.text = `$(sync~spin) ${first.label}${suffix}${msg}`;
    this.item.tooltip = this.remoteHint
      ? `Remote: ${this.remoteHint}\n${first.label}${msg}`
      : `${first.label}${msg}`;
    this.item.show();
  }
}