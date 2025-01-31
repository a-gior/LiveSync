import { workspace, ConfigurationTarget, WorkspaceFolder } from "vscode";
import * as crypto from "crypto";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { FileEventActionsMessage } from "../DTOs/messages/FileEventActionsMessage";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { IgnoreListMessage } from "../DTOs/messages/IgnoreListMessage";
import path from "path";

export class WorkspaceConfigManager {
  private static _workspaceConfig: ConfigurationState | undefined;

  // Check if the workspace is multi-root
  static isMultiRootWorkspace(): boolean {
    return (workspace.workspaceFolders?.length || 0) > 1;
  }

  // Load the configuration for the workspace
  static loadWorkspaceConfiguration(): ConfigurationState {
    const config = this.getConfiguration();

    return {
      configuration: {
        hostname: config.get<string>("hostname", ""),
        port: config.get<number>("port", 22),
        username: config.get<string>("username", ""),
        authMethod: config.get<string>("authMethod", ""),
        password: config.get<string>("password", ""),
        privateKeyPath: config.get<string>("privateKeyPath", ""),
        passphrase: config.get<string>("passphrase", "")
      },
      remotePath: config.get<string>("remotePath", ""),
      fileEventActions: config.get<FileEventActionsMessage["actions"]>("fileEventActions", {
        actionOnUpload: "check&upload",
        actionOnDownload: "check&download",
        actionOnSave: "check&save",
        actionOnCreate: "create",
        actionOnDelete: "none",
        actionOnMove: "check&move",
        actionOnOpen: "check&download"
      }),
      ignoreList: config.get<string[]>("ignoreList", [])
    };
  }

  // Get the appropriate configuration object
  static getConfiguration(folderUri?: WorkspaceFolder) {
    if (this.isMultiRootWorkspace()) {
      logErrorMessage(
        "LiveSync requires a single folder in the workspace to configure correctly. Please ensure only one folder is selected.",
        LOG_FLAGS.ALL
      );
      throw new Error("LiveSync requires a single folder in the workspace to configure correctly.");
    }

    const targetFolder = folderUri || workspace.workspaceFolders?.[0];
    return workspace.getConfiguration("LiveSync", targetFolder?.uri);
  }

  // Save the workspace configuration
  static async saveConfiguration(state: ConfigurationState): Promise<void> {
    await WorkspaceConfigManager.batchUpdate({
      hostname: state.configuration?.hostname,
      port: state.configuration?.port,
      username: state.configuration?.username,
      authMethod: state.configuration?.authMethod,
      password: state.configuration?.password,
      privateKeyPath: state.configuration?.privateKeyPath,
      passphrase: state.configuration?.passphrase,
      remotePath: state.remotePath,
      fileEventActions: state.fileEventActions,
      ignoreList: state.ignoreList
    });
  }

  // Initialize event listeners for workspace changes
  static initialize(): void {
    workspace.onDidChangeWorkspaceFolders(this.initializeConfiguration.bind(this));
  }

  // Initialize the configuration based on the workspace type
  static initializeConfiguration(): void {
    logInfoMessage(
      this.isMultiRootWorkspace()
        ? "Multi-root workspace detected. Using global configuration."
        : "Single folder workspace detected. Using folder-specific configuration.",
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );

    this._workspaceConfig = this.loadWorkspaceConfiguration();
  }

  // Get the loaded configuration
  static getWorkspaceConfiguration(): ConfigurationState {
    if (!this._workspaceConfig) {
      this._workspaceConfig = this.loadWorkspaceConfiguration();
    }
    return this._workspaceConfig;
  }

  // Get the remote server configuration
  static getRemoteServerConfigured(): ConfigurationMessage["configuration"] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig.configuration) {
      logErrorMessage("Remote server not configured", LOG_FLAGS.ALL);
      throw new Error("Remote server not configured");
    }

    return workspaceConfig.configuration;
  }

  // Get current workspace path
  static getWorkspaceLocalPath(): string {
    const workspaceFolders = workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folders found");
    }

    return workspaceFolders[0].uri.fsPath;
  }

  // Get configured remote path
  static getRemotePath(): string {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig.remotePath || workspaceConfig.remotePath.length === 0) {
      logErrorMessage("Remote path not configured", LOG_FLAGS.ALL);
      throw new Error("Remote path not configured");
    }

    return workspaceConfig.remotePath;
  }

  // Get full local and remote paths
  static getWorkspaceFullPaths() {
    return {
      localPath: this.getWorkspaceLocalPath(),
      remotePath: this.getRemotePath()
    };
  }

  static getWorkspaceBasename(): string {
    return path.basename(this.getWorkspaceLocalPath());
  }

  // Get ignore list
  static getIgnoreList(): IgnoreListMessage["ignoreList"] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig.ignoreList) {
      logErrorMessage("Ignore List not configured", LOG_FLAGS.ALL);
      throw new Error("Ignore List not configured");
    }

    return workspaceConfig.ignoreList;
  }

  // Get a specific parameter
  static getParameter<T>(paramName: string): T | undefined {
    const config = this.getConfiguration();
    return config.get<T>(paramName);
  }

  // Update a specific parameter
  static async update(paramName: string, value: any): Promise<void> {
    try {
      // Update the persistent settings in VS Code
      const config = this.getConfiguration();
      await config.update(paramName, value, ConfigurationTarget.Workspace);

      logInfoMessage(`${paramName} updated`);
      // Reload the in-memory configuration
      this.reload();
    } catch (error: any) {
      logErrorMessage(`Failed to update configuration: ${paramName}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
      throw new Error(error.message);
    }
  }

  static async batchUpdate(updates: Record<string, any>): Promise<void> {
    try {
      const config = this.getConfiguration();

      // Perform all updates without reloading
      for (const [key, value] of Object.entries(updates)) {
        await config.update(key, value, ConfigurationTarget.Workspace);
      }
      logInfoMessage("Batch configuration updates applied:", LOG_FLAGS.CONSOLE_ONLY, updates);

      // Reload the configuration once after all updates
      this.reload();
    } catch (error) {
      console.error("Failed to perform batch updates", error);
      throw new Error("Batch updates failed");
    }
  }

  // Reload the in-memory workspace configuration
  static reload(): void {
    this._workspaceConfig = this.loadWorkspaceConfiguration();
    logInfoMessage("Workspace configuration reloaded.");
  }

  /**
   * Get the workspace path and a unique identifier for the workspace.
   * @returns An object containing the workspace path and identifier.
   */
  static getWorkspaceHash(): { path: string | undefined; identifier: string } {
    let workspacePath: string | undefined;
    const workspaceFolders = workspace.workspaceFolders;

    if (workspace.workspaceFile) {
      // Multi-root workspace: Use the path to the `.code-workspace` file
      workspacePath = workspace.workspaceFile.fsPath;
    } else if (workspaceFolders && workspaceFolders.length === 1) {
      // Single-folder workspace: Use the folder path
      workspacePath = workspaceFolders[0].uri.fsPath;
    } else {
      // No workspace open
      workspacePath = undefined;
    }

    // Generate a unique identifier for the workspace
    const identifier = workspacePath ? crypto.createHash("md5").update(workspacePath).digest("hex") : "global";

    return { path: workspacePath, identifier };
  }
}
