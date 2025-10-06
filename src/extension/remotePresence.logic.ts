export function decidePresence(
  hasRemotes: boolean[],
  workspaceCount: number
): { supportsDownload: boolean; hint: string | undefined } {
  if (workspaceCount === 0) {
    return { supportsDownload: false, hint: undefined };
  }
  if (workspaceCount === 1) {
    const has = hasRemotes[0] ?? false;
    return { supportsDownload: has, hint: has ? undefined : 'local snapshot' };
  }
  const count = hasRemotes.filter(Boolean).length;
  const any = count > 0;
  return { supportsDownload: any, hint: any ? `${count}/${workspaceCount} remotes` : `${workspaceCount} workspaces` };
}
