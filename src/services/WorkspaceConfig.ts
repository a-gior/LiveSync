import { workspace, window, ConfigurationTarget } from "vscode";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { PairFoldersMessage } from "@shared/DTOs/messages/PairFoldersMessage";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";

export class WorkspaceConfig {
  private static instance: WorkspaceConfig;
  private static _workspaceConfig: ConfigurationState | undefined;

  static getInstance(): WorkspaceConfig {
    if (!WorkspaceConfig.instance) {
      WorkspaceConfig.instance = new WorkspaceConfig();
    }
    return WorkspaceConfig.instance;
  }

  getWorkspaceConfiguration(): ConfigurationState {
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

    if (actionOnCreate && actionOnDelete && actionOnMove && actionOnSave) {
      workspaceConfig.fileEventActions = {
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

  getRemoteServerConfigured(): ConfigurationMessage["configuration"] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig["configuration"]) {
      window.showErrorMessage("Remote server not configured");
      throw Error("Remote server not configured");
    }

    return workspaceConfig["configuration"];
  }

  getPairedFoldersConfigured(): PairFoldersMessage["paths"][] {
    const workspaceConfig = this.getWorkspaceConfiguration();

    if (!workspaceConfig["pairedFolders"]) {
      window.showErrorMessage("Paired Folders not configured");
      throw Error("Paired Folders not configured");
    }

    return workspaceConfig["pairedFolders"];
  }

  getAll() {
    return this.getWorkspaceConfiguration();
  }

  getParameter(paramName: string) {
    const config = workspace.getConfiguration("LiveSync");
    return config.get<string>(paramName);
  }

  async update(paramName: string, value: any) {
    const config = workspace.getConfiguration("LiveSync");
    await config.update(paramName, value, ConfigurationTarget.Workspace);
    this.reloadConfiguration();
  }

  reloadConfiguration() {
    WorkspaceConfig._workspaceConfig = undefined;
    this.getWorkspaceConfiguration();
  }
}
