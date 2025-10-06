export type RefreshDecision =
  | { kind: 'file'; path: string }
  | { kind: 'parent'; path?: string }
  | { kind: 'workspace' };

/**
 * Decide which node to refresh in the tree.
 * - If the changed entry still exists and its node is realized, refresh that file node.
 * - Else if the parent is realized, refresh the parent (e.g., after delete/create).
 * - Else refresh the workspace root.
 */
export function computeRefreshTarget(params: {
  changedPath?: string;
  parentPath?: string;
  entryStillExists: boolean;
  realizedPaths: ReadonlySet<string>;
}): RefreshDecision {
  const { changedPath, parentPath, entryStillExists, realizedPaths } = params;

  if (changedPath && entryStillExists && realizedPaths.has(changedPath)) {
    return { kind: 'file', path: changedPath };
  }

  if (parentPath && realizedPaths.has(parentPath)) {
    return { kind: 'parent', path: parentPath };
  }

  return { kind: 'workspace' };
}
