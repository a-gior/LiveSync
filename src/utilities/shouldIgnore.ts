import path from "path";
import { LOG_FLAGS, logInfoMessage } from "../managers/LogManager";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";

export function shouldIgnore(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  const matchers  = WorkspaceConfigManager.getIgnoreMatchers();

  for (const m of matchers) {
    if (m.match(normalized)) {
      logInfoMessage(`Ignored: ${filePath}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
      return true;
    }
  }

  return false;
}
