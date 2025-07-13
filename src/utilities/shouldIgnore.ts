import path from "path";
import { LOG_FLAGS, logInfoMessage } from "../managers/LogManager";
import { WorkspaceFolder } from "vscode";
import { configManager } from "../extension";

export function shouldIgnore(workspaceFolder: WorkspaceFolder, filePath: string): boolean {
  const normalized = path.normalize(filePath);
  const matchers  = configManager!.getConfig(workspaceFolder.uri).compiledIgnoreList;

  for (const m of matchers) {
    if (m.match(normalized)) {
      logInfoMessage(`Ignored: ${filePath}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
      return true;
    }
  }

  return false;
}
