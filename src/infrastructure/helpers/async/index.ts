import * as vscode from 'vscode';

export async function withProgress<T>(
  title: string,
  fn: (p: vscode.Progress<{ message?: string }>, token: vscode.CancellationToken) => Promise<T>
): Promise<T> {
  return vscode.window.withProgress(
    { title, location: vscode.ProgressLocation.Notification, cancellable: true },
    fn
  );
}

export function reportCounter(
  p: vscode.Progress<{ message?: string }>,
  done: number,
  total: number
): void {
  p.report({ message: `${done}/${total}` });
}

/** Iterate with cancellation & optional progress callback. */
export async function forEachCancelable<T>(
  items: readonly T[],
  token: vscode.CancellationToken,
  each: (item: T, idx: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const total = items.length;
  for (let i = 0; i < total; i += 1) {
    if (token.isCancellationRequested) { break; }
    await each(items[i], i);
    if (onProgress) { onProgress(i + 1, total); }
  }
}
