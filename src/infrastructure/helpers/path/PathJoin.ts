import path from "path";
import { RelPath, WorkspaceId } from "@domain/types";
import { pathToString } from "./PathCast";
import { Uri } from "vscode";

/** Absolute filesystem path from workspace + relative path. */
export function absFs(workspaceId: WorkspaceId, rel: RelPath): string {
  const root = pathToString(workspaceId).replace(/\\/g, '/').replace(/\/+$/, '');
  const rr = pathToString(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  return path.join(root, rr);
}

export function uriFromRel(workspaceId: WorkspaceId, rel: RelPath): Uri {
  return Uri.file(absFs(workspaceId, rel));
}