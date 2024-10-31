import path from "path";
import { LOG_FLAGS, logInfoMessage } from "../services/LogManager";
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
    logInfoMessage(`Ignored: ${filePath}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
  }

  return shouldIgnore;
}
