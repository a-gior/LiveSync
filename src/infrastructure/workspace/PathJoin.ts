export function joinFs(workspaceId: string, relativePath: string): string {
  const root = workspaceId.replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${root}/${rel}`;
}
