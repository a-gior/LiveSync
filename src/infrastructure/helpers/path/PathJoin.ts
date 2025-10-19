import path from "path";
import { RelPath, WorkspaceId } from "@domain/types";
import { relToString, wsToString } from "./PathCast";

/** Absolute filesystem path from workspace + relative path. */
export function absFs(workspaceId: WorkspaceId, rel: RelPath): string {
  const root = wsToString(workspaceId).replace(/\\/g, '/').replace(/\/+$/, '');
  const rr = relToString(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  return path.join(root, rr);
}