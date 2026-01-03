import { RelPath, WorkspaceId } from "@domain/types";

export function pathToString(p: RelPath|WorkspaceId): string {
  return p as string;
}

export function stringToRel(s: string): RelPath {
  return s as RelPath;
}

export function wsToString(id: WorkspaceId): string {
  return id as string;
}

export function stringToWsId(s: string): WorkspaceId {
  return s as WorkspaceId;
}