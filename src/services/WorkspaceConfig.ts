import { workspace, window, ConfigurationTarget } from "vscode";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { PairFoldersMessage } from "@shared/DTOs/messages/PairFoldersMessage";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { IgnoreListMessage } from "../DTOs/messages/IgnoreListMessage";

export class WorkspaceConfig2 {
  private static _workspaceConfig: ConfigurationState | undefined;

  static getWorkspaceConfig2uration(): ConfigurationState {
    if (WorkspaceConfig2._workspaceConfig) {
      return WorkspaceConfig2._workspaceConfig;
    }

    const config = workspace.getConfiguration("LiveSync");

    // Get individual configuration values
    const hostname = config.get<string>("hostname");
    const port = config.get<number>("port");
    const username = config.get<string>("username");
    const authMethod = config.get<string | undefined>("authMethod");
    const password = config.get<string>("password");
    const sshKeyFilePath = config.get<string>("sshKey");

    const pairedFolders =
      config.get<Array<PairFoldersMessage["paths"]>>("pairedFolders");

    const actionOnUpload = config.get<string>("actionOnUpload");
    const actionOnDownload = config.get<string>("actionOnDownload");
    const actionOnSave = config.get<string>("actionOnSave");
    const actionOnDelete = config.get<string>("actionOnDelete");
    const actionOnCreate = config.get<string>("actionOnCreate");
    const actionOnMove = config.get<string>("actionOnMove");
    const actionOnOpen = config.get<string>("actionOnOpen");

    const ignoreList = config.get<string[]>("ignore");

    const workspaceConfig: ConfigurationState = {};

    // Return null if any value is empty or undefined
    if (hostname && port && username && (password ?? sshKeyFilePath)) {
      workspaceConfig.configuration = {
        hostname: hostname,
        port: port,
        username: username,
        authMethod: authMethod,
        password: password,
        sshKey: sshKeyFilePath,
      };
    }

    if (pairedFolders) {
      workspaceConfig.pairedFolders = pairedFolders;
    }

    if (
      actionOnCreate &&
      actionOnDelete &&
      actionOnMove &&
      actionOnSave &&
      actionOnUpload &&
      actionOnDownload &&
      actionOnOpen
    ) {
      workspaceConfig.fileEventActions = {
        actionOnUpload: actionOnUpload,
        actionOnDownload: actionOnDownload,
        actionOnSave: actionOnSave,
        actionOnCreate: actionOnCreate,
        actionOnDelete: actionOnDelete,
        actionOnMove: actionOnMove,
        actionOnOpen: actionOnOpen,
      };
    }

    if (ignoreList) {
      workspaceConfig.ignoreList = ignoreList;
    }

    WorkspaceConfig2._workspaceConfig = workspaceConfig;
    return workspaceConfig;
  }

  static getRemoteServerConfigured(): ConfigurationMessage["configuration"] {
    const workspaceConfig = this.getWorkspaceConfig2uration();

    if (!workspaceConfig["configuration"]) {
      window.showErrorMessage("Remote server not configured");
      throw new Error("Remote server not configured");
    }

    return workspaceConfig["configuration"];
  }

  static getPairedFoldersConfigured(): PairFoldersMessage["paths"][] {
    const workspaceConfig = this.getWorkspaceConfig2uration();

    if (!workspaceConfig["pairedFolders"]) {
      window.showErrorMessage("Paired Folders not configured");
      throw new Error("Paired Folders not configured");
    }

    return workspaceConfig["pairedFolders"];
  }

  static getIgnoreList(): IgnoreListMessage["ignoreList"] {
    const workspaceConfig = this.getWorkspaceConfig2uration();

    if (!workspaceConfig["ignoreList"]) {
      window.showErrorMessage("Ignore List not configured");
      throw new Error("Ignore List not configured");
    }

    return workspaceConfig["ignoreList"];
  }

  static getAll() {
    return this.getWorkspaceConfig2uration();
  }

  static getParameter<T>(paramName: string): T | undefined {
    const config = workspace.getConfiguration("LiveSync");
    return config.get<T>(paramName);
  }

  static async update(paramName: string, value: any) {
    const config = workspace.getConfiguration("LiveSync");
    await config.update(paramName, value, ConfigurationTarget.Workspace);
    this.reloadConfiguration();
  }

  static reloadConfiguration() {
    this._workspaceConfig = undefined;
    this.getWorkspaceConfig2uration();
  }
}
