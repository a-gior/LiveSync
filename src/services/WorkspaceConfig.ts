import { workspace, window, ConfigurationTarget } from "vscode";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { PairFoldersMessage } from "@shared/DTOs/messages/PairFoldersMessage";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { IgnoreListMessage } from "../DTOs/messages/IgnoreListMessage";

export class WorkspaceConfig {
  private static _workspaceConfig: ConfigurationState | undefined;

  static getWorkspaceConfiguration(): ConfigurationState {
    if (WorkspaceConfig._workspaceConfig) {
      return WorkspaceConfig._workspaceConfig;
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
    const actionOnSave = config.get<string>("actionOnSave");
    const actionOnDelete = config.get<string>("actionOnDelete");
    const actionOnCreate = config.get<string>("actionOnCreate");
    const actionOnMove = config.get<string>("actionOnMove");

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
      actionOnUpload
    ) {
      workspaceConfig.fileEventActions = {
        actionOnUpload: actionOnUpload,
        actionOnSave: actionOnSave,
        actionOnCreate: actionOnCreate,
        actionOnDelete: actionOnDelete,
        actionOnMove: actionOnMove,
      };
    }

    if (ignoreList) {
      workspaceConfig.ignoreList = ignoreList;
    }

    WorkspaceConfig._workspaceConfig = workspaceConfig;
    return workspaceConfig;
  }

  static getRemoteServerConfigured(): ConfigurationMessage["configuration"] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig["configuration"]) {
      window.showErrorMessage("Remote server not configured");
      throw new Error("Remote server not configured");
    }

    return workspaceConfig["configuration"];
  }

  static getPairedFoldersConfigured(): PairFoldersMessage["paths"][] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig["pairedFolders"]) {
      window.showErrorMessage("Paired Folders not configured");
      throw new Error("Paired Folders not configured");
    }

    return workspaceConfig["pairedFolders"];
  }

  static getIgnoreList(): IgnoreListMessage["ignoreList"] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig["ignoreList"]) {
      window.showErrorMessage("Ignore List not configured");
      throw new Error("Ignore List not configured");
    }

    return workspaceConfig["ignoreList"];
  }

  static getAll() {
    return this.getWorkspaceConfiguration();
  }

  static getParameter(paramName: string) {
    const config = workspace.getConfiguration("LiveSync");
    return config.get<string>(paramName);
  }

  static async update(paramName: string, value: any) {
    const config = workspace.getConfiguration("LiveSync");
    await config.update(paramName, value, ConfigurationTarget.Workspace);
    this.reloadConfiguration();
  }

  static reloadConfiguration() {
    this._workspaceConfig = undefined;
    this.getWorkspaceConfiguration();
  }
}
