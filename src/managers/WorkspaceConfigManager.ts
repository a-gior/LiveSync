import { workspace, ConfigurationTarget, WorkspaceFolder } from "vscode";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { PairFoldersMessage } from "../DTOs/messages/PairFoldersMessage";
import { FileEventActionsMessage } from "../DTOs/messages/FileEventActionsMessage";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { ConfigurationMessage } from "../DTOs/messages/ConfigurationMessage";
import { IgnoreListMessage } from "../DTOs/messages/IgnoreListMessage";

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
        sshKey: config.get<string>("sshKey", ""),
      },
      pairedFolders: config.get<PairFoldersMessage["paths"][]>(
        "pairedFolders",
        [],
      ),
      fileEventActions: config.get<FileEventActionsMessage["actions"]>(
        "fileEventActions",
        {
          actionOnUpload: "check&upload",
          actionOnDownload: "check&download",
          actionOnSave: "check&save",
          actionOnCreate: "check&create",
          actionOnDelete: "check&delete",
          actionOnMove: "check&move",
          actionOnOpen: "check&download",
        },
      ),
      ignoreList: config.get<string[]>("ignoreList", []),
    };
  }

  // Get the appropriate configuration object
  static getConfiguration(folderUri?: WorkspaceFolder) {
    if (this.isMultiRootWorkspace()) {
      return workspace.getConfiguration("LiveSync");
    }

    const targetFolder = folderUri || workspace.workspaceFolders?.[0];
    return workspace.getConfiguration("LiveSync", targetFolder?.uri);
  }

  // Save the workspace configuration
  static async saveConfiguration(state: ConfigurationState): Promise<void> {
    const config = this.getConfiguration();

    await config.update(
      "hostname",
      state.configuration?.hostname,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "port",
      state.configuration?.port,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "username",
      state.configuration?.username,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "authMethod",
      state.configuration?.authMethod,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "password",
      state.configuration?.password,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "sshKey",
      state.configuration?.sshKey,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "pairedFolders",
      state.pairedFolders,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "fileEventActions",
      state.fileEventActions,
      ConfigurationTarget.Workspace,
    );
    await config.update(
      "ignoreList",
      state.ignoreList,
      ConfigurationTarget.Workspace,
    );
  }

  // Initialize event listeners for workspace changes
  static initialize(): void {
    workspace.onDidChangeWorkspaceFolders(
      this.initializeConfiguration.bind(this),
    );
  }

  // Initialize the configuration based on the workspace type
  static initializeConfiguration(): void {
    logInfoMessage(
      this.isMultiRootWorkspace()
        ? "Multi-root workspace detected. Using global configuration."
        : "Single folder workspace detected. Using folder-specific configuration.",
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
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

  // Get paired folders
  static getPairedFoldersConfigured(): PairFoldersMessage["paths"][] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (
      !workspaceConfig.pairedFolders ||
      workspaceConfig.pairedFolders.length === 0
    ) {
      logErrorMessage("Paired Folders not configured", LOG_FLAGS.ALL);
      throw new Error("Paired Folders not configured");
    }

    return workspaceConfig.pairedFolders;
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

      // Reload the in-memory configuration
      this.reload();

      logInfoMessage(
        `Configuration updated: ${paramName}`,
        LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
        value,
      );
    } catch (error) {
      logErrorMessage(
        `Failed to update configuration: ${paramName}`,
        LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
        error,
      );
      throw new Error(`Failed to update configuration: ${paramName}`);
    }
  }

  static async batchUpdate(updates: Record<string, any>): Promise<void> {
    try {
      const config = this.getConfiguration();

      // Perform all updates without reloading
      for (const [key, value] of Object.entries(updates)) {
        await config.update(key, value, ConfigurationTarget.Workspace);
      }

      // Reload the configuration once after all updates
      this.reload();

      console.log("Batch configuration updates applied:", updates);
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
}
