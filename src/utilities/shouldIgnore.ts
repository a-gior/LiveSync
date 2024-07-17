import path from "path";
import { LogManager } from "../services/LogManager";
import { WorkspaceConfig } from "../services/WorkspaceConfig";
import { minimatch } from "minimatch";

export function shouldIgnore(filePath: string): boolean {
  const ignoreList = WorkspaceConfig.getIgnoreList();
  const shouldIgnore = ignoreList.some(
    (pattern) =>
      minimatch(filePath, pattern) ||
      minimatch(path.basename(filePath), pattern),
  );

  if (shouldIgnore) {
    console.log(`Ignored: ${filePath}`);
    LogManager.log(`Ignored: ${filePath}`);
  }

  return shouldIgnore;
}
