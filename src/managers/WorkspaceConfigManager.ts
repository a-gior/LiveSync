import { workspace, ConfigurationTarget, ExtensionContext, WorkspaceFolder, Uri } from "vscode";
import * as crypto from "crypto";
import { LOG_FLAGS, logConfigError, logErrorMessage, logInfoMessage } from "./LogManager";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import path from "path";
import { FileEventHandler } from "../services/FileEventHandler";
import { Minimatch } from "minimatch";
import { ConfigurationPanel } from "../panels/ConfigurationPanel";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";

function describeCurrentWorkspace() {
  const folders: readonly WorkspaceFolder[] | undefined = workspace.workspaceFolders;
  const wsFile: Uri | undefined = workspace.workspaceFile;

  if (!folders) {
    return "No workspace is open at all.";
  }

  // 1. Single-folder (just one folder, no .code-workspace file)
  if (folders.length === 1 && !wsFile) {
    return `Single-folder workspace: ${folders[0].uri.fsPath}`;
  }

  // 2. Multi-root untitled (you added folders at runtime, VS Code created an in-memory “Untitled” workspace)
  if (wsFile?.scheme === 'untitled') {
    return `Untitled multi-root workspace with ${folders.length} folders`;
  }

  // 3. Multi-root saved (you opened a .code-workspace file from disk)
  if (wsFile?.scheme === 'file' && wsFile.fsPath.endsWith('.code-workspace')) {
    return `Saved multi-root workspace (${wsFile.fsPath}) with ${folders.length} folders`;
  }

  // 4. Edge—unlikely, but covers any other scenario
  return `Workspace with ${folders.length} folders; file: ${wsFile?.toString()}`;
}

export class WorkspaceConfigManager {
  private static _workspaceConfig: ConfigurationState | undefined;
  private static _context: ExtensionContext;
  public static isVscodeSettingsValid: boolean = false;

  // cache the compiled matchers so we only do this once
  private static compiledIgnoreMatchers: Minimatch[] | null = null;

  // Check if the workspace is multi-root
  static isMultiRootWorkspace(): boolean {
    console.log("CURRENT WORKSPACE: "+describeCurrentWorkspace());
    return (workspace.workspaceFolders?.length || 0) > 1;
  }

  // Load the configuration for the workspace
  static loadWorkspaceConfiguration() {

    if (!WorkspaceConfigManager.isVSCodeConfigValid()) {
      logConfigError(this._context, LOG_FLAGS.ALL, true);
    } else {
      this._context.globalState.update('suppressConfigError', false);
    }

    const config = this.getVSCodeConfiguration();

    this._workspaceConfig = {
      configuration: {
        hostname: config.get<string>("hostname", ""),
        port: config.get<number>("port", 22),
        username: config.get<string>("username", ""),
        password: config.get<string>("password", ""),
        privateKeyPath: config.get<string>("privateKeyPath", ""),
        passphrase: config.get<string>("passphrase", "")
      },
      remotePath: config.get<string>("remotePath", ""),
      fileEventActions: {
        actionOnUpload: config.get<string>("actionOnUpload", "check&upload"),
        actionOnDownload: config.get<string>("actionOnDownload", "check&download"),
        actionOnSave: config.get<string>("actionOnSave", "check&save"),
        actionOnCreate: config.get<string>("actionOnCreate", "create"),
        actionOnDelete: config.get<string>("actionOnDelete", "none"),
        actionOnMove: config.get<string>("actionOnMove", "check&move"),
        actionOnOpen: config.get<string>("actionOnOpen", "check&download")
      },
      ignoreList: config.get<string[]>("ignoreList", [".vscode"])
    };
  }

  // Get the appropriate configuration object
  static getVSCodeConfiguration() {
    // if (this.isMultiRootWorkspace()) {
    //   logErrorMessage(
    //     "LiveSync requires a single folder in the workspace to configure correctly. Please ensure only one folder is selected.",
    //     LOG_FLAGS.ALL
    //   );
    //   throw new Error("LiveSync requires a single folder in the workspace to configure correctly.");
    // }

    const targetFolder = workspace.workspaceFolders?.[0];
    return workspace.getConfiguration("LiveSync", targetFolder?.uri);
  }

  static isVSCodeConfigValid(): boolean {
    const config = this.getVSCodeConfiguration();

    const connectionSettings = {
      hostname: config.get<string>("hostname"),
      port: config.get<number>("port", 22),
      username: config.get<string>("username"),
      password: config.get<string>("password"),
      privateKeyPath: config.get<string>("privateKeyPath"),
      passphrase: config.get<string>("passphrase")
    };

    // Helper function to check if a value is set
    const isSet = (value: any) => !!(value && value.trim() !== "");

    // Validate required fields
    if (!isSet(connectionSettings.hostname) || !isSet(connectionSettings.username)) {
      this.isVscodeSettingsValid = false;
      return false;
    }

    // Validate authentication method
    if (!isSet(connectionSettings.privateKeyPath) && !isSet(connectionSettings.password)) {
      this.isVscodeSettingsValid = false;
      return false;
    }

    this.isVscodeSettingsValid = true;
    return true;
  }

  // Save the workspace configuration
  static async saveConfiguration(state: ConfigurationState): Promise<void> {
    await WorkspaceConfigManager.batchUpdate({
      hostname: state.configuration?.hostname,
      port: state.configuration?.port,
      username: state.configuration?.username,
      password: state.configuration?.password,
      privateKeyPath: state.configuration?.privateKeyPath,
      passphrase: state.configuration?.passphrase,
      remotePath: state.remotePath,
      fileEventActions: state.fileEventActions,
      ignoreList: state.ignoreList
    });
  }

  // Initialize event listeners for workspace changes
  public static initialize(context: ExtensionContext): void {
    // 1) store the context
    this._context = context;

    // 2) run configuration logic immediately
    this.initializeConfiguration();

    // 3) re‐run whenever the workspace folders change
    workspace.onDidChangeWorkspaceFolders(
      () => this.initializeConfiguration()
    );
  }

  // Initialize the configuration based on the workspace type
  static initializeConfiguration(): void {
    logInfoMessage(
      this.isMultiRootWorkspace()
        ? "Multi-root workspace detected. Using global configuration."
        : "Single folder workspace detected. Using folder-specific configuration.",
      LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
    );

    this.loadWorkspaceConfiguration();
  }

  // Get the loaded configuration
  static getWorkspaceConfiguration(): ConfigurationState {
    if (!this._workspaceConfig) {
      this.loadWorkspaceConfiguration();
    }

    return this._workspaceConfig!;
  }

  // Get the remote server configuration
  static getRemoteServerConfigured(): ConfigurationMessage["configuration"] {
    if (!this.isVscodeSettingsValid) {
      logConfigError(this._context, LOG_FLAGS.ALL, true);
    }

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
    if (!this.isVscodeSettingsValid) {
      logConfigError(this._context, LOG_FLAGS.ALL, true);
    }

    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig.remotePath || workspaceConfig.remotePath.length === 0) {
      // logErrorMessage("Remote path not configured", LOG_FLAGS.ALL);
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

  /**
   * Returns an array of pre-compiled Minimatch objects,
   * expanding plain folder names into globs so they catch their contents.
   */
  static getIgnoreMatchers(): Minimatch[] {
    if (!this.compiledIgnoreMatchers) {
      if (!this.isVscodeSettingsValid) {
        logConfigError(this._context, LOG_FLAGS.ALL, true);
      }

      const workspaceConfig = this.getWorkspaceConfiguration();
      if (!workspaceConfig.ignoreList) {
        logErrorMessage("Ignore List not configured", LOG_FLAGS.ALL);
        throw new Error("Ignore List not configured");
      }

      const raw = workspaceConfig.ignoreList;

      const expandedGlobs = raw.flatMap((pattern) =>
        pattern.includes("/") || pattern.includes("*")
          ? [pattern]
          : [pattern, `**/${pattern}/**`]
      );

      // here we use the Minimatch class directly for typing
      this.compiledIgnoreMatchers = expandedGlobs.map(
        (glob) => new Minimatch(glob, { dot: true, matchBase: true })
      );
    }

    return this.compiledIgnoreMatchers;
  }

/**
   * Adds one or more paths to the existing ignore list (skips duplicates).
   * Usage: addToIgnoreList("/a", "/b", "/c")
   */
  static async addToIgnoreList(...paths: string[]) {
    try {
      // 1. Fetch current list (may be undefined)
      const current: string[] | undefined = await WorkspaceConfigManager.getParameter<string[]>("ignoreList");
      const ignoreList = Array.isArray(current) ? [...current] : [];

      // 2. Filter out any that are already present
      const uniqueNew = paths.filter(p => !ignoreList.includes(p));
      if (uniqueNew.length === 0) {
        logErrorMessage(
          `No new paths to add to ignore list.`,
          LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
        );
        return;
      }

      // 3. Append & persist
      ignoreList.push(...uniqueNew);
      await ConfigurationPanel.saveIgnoreList(ignoreList);

      // 4. Log summary
      logErrorMessage(
        `Added to ignore list:\n  • ${uniqueNew.join("\n  • ")}`,
        LOG_FLAGS.CONSOLE_AND_LOG_MANAGER
      );
    } catch (error) {
      logErrorMessage(
        `Error adding to ignore list: ${paths.join(", ")}`,
        LOG_FLAGS.ALL,
        error
      );
    }
  }

  /** Call if you expect the ignore list to change at runtime */
  static refreshIgnoreMatchers(): void {
    this.compiledIgnoreMatchers = null;
  }

  // Get a specific parameter
  static getParameter<T>(paramName: string): T | undefined {
    if (!this.isVscodeSettingsValid) {
      logConfigError(this._context, LOG_FLAGS.ALL, true);
    }

    const config = this.getVSCodeConfiguration();
    return config.get<T>(paramName);
  }

  // Update a specific parameter
  static async update(paramName: string, value: any): Promise<void> {
    try {
      FileEventHandler.enableFileSave = false;

      // Update the persistent settings in VS Code
      const config = this.getVSCodeConfiguration();
      await config.update(paramName, value, ConfigurationTarget.Workspace);

      logInfoMessage(`${paramName} updated`);
      // Reload the in-memory configuration
      this.reload();

      FileEventHandler.enableFileSave = true;
    } catch (error: any) {
      FileEventHandler.enableFileSave = true;
      logErrorMessage(`Failed to update configuration: ${paramName}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
      throw new Error(error.message);
    }
  }

  static async batchUpdate(updates: Record<string, any>): Promise<void> {
    try {
      FileEventHandler.enableFileSave = false;
      const config = this.getVSCodeConfiguration();

      // Perform all updates without reloading
      for (const [key, value] of Object.entries(updates)) {
        await config.update(key, value, ConfigurationTarget.Workspace);
      }
      logInfoMessage("Batch configuration updates applied:", LOG_FLAGS.CONSOLE_ONLY, updates);

      // Reload the configuration once after all updates
      this.reload();

      FileEventHandler.enableFileSave = true;
    } catch (error) {
      FileEventHandler.enableFileSave = true;
      throw new Error("Batch updates failed");
    }
  }

  // Reload the in-memory workspace configuration
  static reload(): void {
    this.loadWorkspaceConfiguration();
    this.refreshIgnoreMatchers();
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
