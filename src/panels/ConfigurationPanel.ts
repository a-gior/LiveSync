import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  workspace,
  ConfigurationTarget,
  ExtensionContext,
} from "vscode";
import { Panel } from "./Panel";

import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { Client } from "ssh2";
import { SFTPClient } from "../services/SFTPClient";
import { Message } from "@shared/DTOs/messages/Message";
import { PairFoldersMessage } from "@shared/DTOs/messages/PairFoldersMessage";
import * as fs from "fs";
import { FullConfigurationMessage } from "@shared/DTOs/messages/FullConfigurationMessage";
import { FileEventActionsMessage } from "@shared/DTOs/messages/FileEventActionsMessage";
import { config } from "process";
import { ConnectionManager } from "../services/ConnectionManager";
import { SSHClient } from "../services/SSHClient";

export class ConfigurationPanel extends Panel {
  private static _workspaceConfig: ConfigurationState;

  static render(extensionUri: Uri) {
    const viewType = "configurationViewType";
    const title = "Configuration";
    const localResourceRoots = [
      Uri.joinPath(extensionUri, "out"),
      Uri.joinPath(extensionUri, "resources"),
      Uri.joinPath(extensionUri, "webview-ui/public/build"),
    ];
    const configurationCallback = async (message: FullConfigurationMessage) => {
      switch (message.command) {
        case "updateConfiguration":
          console.log("Update all configurations...");
          await this.updateConfiguration(message);
          break;
        case "testConnection":
          console.log("TestConnection...");
          if (message.configuration) {
            await this.testConnection(message.configuration);
          }
          break;
        case "savePairFolders":
          break;
      }
    };
    const filepaths = [
      "resources/css/reset.css",
      "resources/css/vscode.css",
      "webview-ui/public/build/pages/configuration/configuration.css", // generated by compiling svelte with rollup
      "webview-ui/public/build/pages/configuration/configuration.js", // generated by compiling svelte with rollup
    ];

    // Call the render method from the parent class with additional parameters
    super.render(
      extensionUri,
      viewType,
      title,
      localResourceRoots,
      filepaths,
      configurationCallback,
      // Additional options if needed
    );

    const workspaceConfig = this.getWorkspaceConfiguration();
    if (workspaceConfig) {
      const fullConfigMessage: FullConfigurationMessage = {
        command: "setInitialConfiguration",
        configuration: workspaceConfig.configuration,
        pairedFolders: workspaceConfig.pairedFolders,
        fileEventActions: workspaceConfig.fileEventActions,
      };

      this.currentPanel?.getPanel().webview.postMessage(fullConfigMessage);
    }
  }

  static async savePairFolders(
    pairedFoldersArr: PairFoldersMessage["paths"][],
  ) {
    const config = workspace.getConfiguration("LiveSync");
    const currentConnectionConfig = this.getWorkspaceConfiguration();

    for (const pairedFolders of pairedFoldersArr) {
      if (
        currentConnectionConfig &&
        currentConnectionConfig.configuration &&
        currentConnectionConfig.pairedFolders
      ) {
        const connectionManager = ConnectionManager.getInstance(
          currentConnectionConfig.configuration,
        );
        connectionManager
          .doSFTPOperation(async (sftpClient: SFTPClient) => {
            const { localPath, remotePath } = pairedFolders;
            if (!(await sftpClient.pathExists(remotePath))) {
              console.error(
                `Remote folder not found. Local path: ${localPath} & remote path: ${remotePath}`,
              );
              window.showErrorMessage(`Remote folder ${remotePath} not found`);
              return;
            } else if (!fs.existsSync(localPath)) {
              console.error(
                `Local folder not found. Local path: ${localPath} & remote path: ${remotePath}`,
              );
              window.showErrorMessage(`Local folder ${localPath} not found`);
              return;
            } else {
              console.log("Paired Folders are valid");
            }
          })
          .then(async () => {
            // All good so we update the pairedFolders config
            await config.update(
              "pairedFolders",
              pairedFoldersArr,
              ConfigurationTarget.Workspace,
            );
            console.log("Paired Folders are saved");
            window.showInformationMessage("Paired Folders are valid and saved");
          });
      } else {
        window.showErrorMessage(
          "No configuration found or missing properties. Please configure LiveSync correctly",
        );
        return;
      }
    }
  }

  static async saveFileEventActions(
    actions: FileEventActionsMessage["actions"],
  ) {
    const config = workspace.getConfiguration("LiveSync");
    if (actions) {
      config.update("actionOnSave", actions.actionOnSave, true);
      config.update("actionOnCreate", actions.actionOnCreate, true);
      config.update("actionOnDelete", actions.actionOnDelete, true);
      config.update("actionOnMove", actions.actionOnMove, true);

      console.log("File event actions saved successfully.");
      window.showInformationMessage("File event actions saved.");
    } else {
      window.showErrorMessage(
        "No configuration found or missing properties. Please configure LiveSync correctly.",
      );
      return;
    }
  }

  static async saveRemoteServerConfiguration(
    configuration: ConfigurationState["configuration"],
  ) {
    if (configuration) {
      console.log(
        `saveRemoteServerConfiguration - Trying to connect with config: `,
        configuration,
      );
      const connectionManager = ConnectionManager.getInstance(configuration);

      connectionManager
        .doSSHOperation(async (sshClient: SSHClient) => {
          sshClient.waitForConnection();
        })
        .then(async () => {
          const config = workspace.getConfiguration("LiveSync");
          const { hostname, port, username, authMethod, password, sshKey } =
            configuration;

          await config.update(
            "hostname",
            hostname,
            ConfigurationTarget.Workspace,
          );
          await config.update("port", port, ConfigurationTarget.Workspace);
          await config.update(
            "username",
            username,
            ConfigurationTarget.Workspace,
          );
          await config.update(
            "authMethod",
            authMethod,
            ConfigurationTarget.Workspace,
          );
          await config.update(
            "password",
            password,
            ConfigurationTarget.Workspace,
          );
          await config.update("sshKey", sshKey, ConfigurationTarget.Workspace);

          console.log("Remote server configuration saved successfully.");
          window.showInformationMessage("Remote server configuration saved.");
        })
        .catch((err: any) => {
          console.error("Remote server configuration couldnt be saved.", err);
          window.showErrorMessage(
            `Remote server configuration couldn't be saved. \n${err.message}`,
          );
        });
    } else {
      window.showErrorMessage(
        "No configuration found or missing properties. Please configure LiveSync correctly.",
      );
      return;
    }
  }

  static async updateConfiguration(configuration: FullConfigurationMessage) {
    this.saveRemoteServerConfiguration(configuration.configuration);

    if (configuration.pairedFolders) {
      this.savePairFolders(configuration.pairedFolders);
    }
    if (configuration.fileEventActions) {
      this.saveFileEventActions(configuration.fileEventActions);
    }
  }

  static async testConnection(
    configuration: ConfigurationMessage["configuration"],
  ): Promise<boolean> {
    const connectionManager = ConnectionManager.getInstance(configuration);
    connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
      sshClient.waitForConnection();
    });

    const errors = connectionManager.getSSHClient().getErrors();
    if (errors.length > 0) {
      window.showErrorMessage(errors[0].error.message);
      return false;
    } else {
      window.showInformationMessage("Test Connection successful");
      return true;
    }
  }

  static getWorkspaceConfiguration(): ConfigurationState {
    if (this._workspaceConfig) {
      return this._workspaceConfig;
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

    this._workspaceConfig = workspaceConfig;
    return workspaceConfig;
  }
}
