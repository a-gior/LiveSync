export function sortByDepthDesc(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const da = a.split('/').filter(Boolean).length;
    const db = b.split('/').filter(Boolean).length;
    return db - da;
  });
}
