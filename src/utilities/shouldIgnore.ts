import path from "path";
import { LOG_FLAGS, logInfoMessage } from "../managers/LogManager";
import { minimatch } from "minimatch";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";

export function shouldIgnore(filePath: string): boolean {
  const ignoreList = WorkspaceConfigManager.getIgnoreList();
  const shouldIgnore = ignoreList.some((pattern) => minimatch(filePath, pattern) || minimatch(path.basename(filePath), pattern));

  if (shouldIgnore) {
    logInfoMessage(`Ignored: ${filePath}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
  }

  return shouldIgnore;
}
