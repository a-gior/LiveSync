import * as vscode from 'vscode';

export function cmd(context: vscode.ExtensionContext, id: string, fn: (...args: any[]) => unknown): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(id, async (...args) => {
      try {
        await Promise.resolve(fn(...args));
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        vscode.window.showErrorMessage(`LiveSync: ${id} failed — ${msg}`);
      }
    })
  );
}
