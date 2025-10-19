import { WorkspaceFolder } from "vscode";
import { StatusBarManager } from "../managers/StatusBarManager";
import { configManager } from "../extension";
import { FileNodeSource } from "../utilities/FileNode";
import { LOG_FLAGS, logConfigError, logErrorMessage } from "../managers/LogManager";

export class WorkspaceConfigError extends Error {
  constructor(public readonly folder: WorkspaceFolder, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "WorkspaceConfigError";
    
    StatusBarManager.markErrored(folder.uri.fsPath.toString(), message);
  }
}

export function handleConfigError(err: any, localPathOrFolder: string | WorkspaceFolder, shouldThrow: boolean = false): void {
    let workspaceFolder: WorkspaceFolder;
    if(typeof localPathOrFolder === 'string') {
        workspaceFolder = configManager!.getWorkspaceFolderFromPath(localPathOrFolder, FileNodeSource.local);
    } else {
        workspaceFolder = localPathOrFolder;
    }

    if (err instanceof WorkspaceConfigError) {
        logConfigError(LOG_FLAGS.ALL, workspaceFolder, `[${workspaceFolder.name}] ${err.message}`);
    } else if(shouldThrow) {
        throw err;
    } else {
        logErrorMessage(`<handleConfigError> ${err.message}`, LOG_FLAGS.CONSOLE_ONLY);
    }
}