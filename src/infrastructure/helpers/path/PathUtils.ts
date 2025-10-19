import { RelPath } from "../../../domain/types";
import { relToString } from "./PathCast";

/** Returns true if candidate is exactly base or under base/<...> */
export function isUnder(base: RelPath, candidate: RelPath): boolean {
  const b = relToString(base).replace(/\/+$/, '');
  const c = relToString(candidate);
  if (b.length === 0) { return true; }
  return c === b || c.startsWith(b + '/');
}