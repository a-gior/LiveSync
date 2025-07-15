import { Uri } from "vscode";

/**
 * Generic URI-keyed map type.
 */
export type UriMap<T> = Map<string, T>;

/**
 * Type for expand/collapse state per relative path.
 */
export type FolderState = Record<string, boolean>;