import { window, Uri } from "vscode";
import { Panel } from "./Panel";

import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { SFTPClient } from "../services/SFTPClient";
import { PairFoldersMessage } from "@shared/DTOs/messages/PairFoldersMessage";
import * as fs from "fs";
import { FullConfigurationMessage } from "@shared/DTOs/messages/FullConfigurationMessage";
import { FileEventActionsMessage } from "@shared/DTOs/messages/FileEventActionsMessage";
import { ConnectionManager } from "../services/ConnectionManager";
import { SSHClient } from "../services/SSHClient";
import { WorkspaceConfig } from "../services/WorkspaceConfig";
import { IgnoreListMessage } from "../DTOs/messages/IgnoreListMessage";

export class ConfigurationPanel extends Panel {
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

    const allWorkspaceConfig: FullConfigurationMessage = {
      command: "setInitialConfiguration",
      ...WorkspaceConfig.getInstance().getAll(),
    };
    this.currentPanel?.getPanel().webview.postMessage(allWorkspaceConfig);
  }

  static async savePairFolders(
    pairedFoldersArr: PairFoldersMessage["paths"][],
  ) {
    console.log("pairedFoldersArr", pairedFoldersArr);
    const workspaceConfig = WorkspaceConfig.getInstance();
    const configuration = workspaceConfig.getRemoteServerConfigured();
    // const pairedFolders = workspaceConfig.getPairedFoldersConfigured();

    const connectionManager = ConnectionManager.getInstance(configuration);
    connectionManager
      .doSFTPOperation(async (sftpClient: SFTPClient) => {
        for (const pairedFolders of pairedFoldersArr) {
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
        }
      }, "Saving PairedFolders")
      .then(async () => {
        // All good so we update the pairedFolders config
        await workspaceConfig.update("pairedFolders", pairedFoldersArr);
        console.log("Paired Folders are saved");
        window.showInformationMessage("Paired Folders are valid and saved");
      });
  }

  static async saveFileEventActions(
    actions: FileEventActionsMessage["actions"],
  ) {
    console.log("saveActions", actions);
    const workspaceConfig = WorkspaceConfig.getInstance();
    if (actions) {
      await workspaceConfig.update("actionOnSave", actions.actionOnSave);
      await workspaceConfig.update("actionOnCreate", actions.actionOnCreate);
      await workspaceConfig.update("actionOnDelete", actions.actionOnDelete);
      await workspaceConfig.update("actionOnMove", actions.actionOnMove);

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
      const connectionManager = ConnectionManager.getInstance(configuration);
      const workspaceConfig = WorkspaceConfig.getInstance();

      connectionManager
        .doSSHOperation(async (sshClient: SSHClient) => {
          sshClient.waitForConnection();
        }, "Test Connection")
        .then(async () => {
          const { hostname, port, username, authMethod, password, sshKey } =
            configuration;

          await workspaceConfig.update("hostname", hostname);
          await workspaceConfig.update("port", port);
          await workspaceConfig.update("username", username);
          await workspaceConfig.update("authMethod", authMethod);
          await workspaceConfig.update("password", password);
          await workspaceConfig.update("sshKey", sshKey);

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

  static async saveIgnoreList(ignoreList: IgnoreListMessage["ignoreList"]) {
    console.log(`<saveIgnoreList> list: `, ignoreList);
    const workspaceConfig = WorkspaceConfig.getInstance();

    if (ignoreList) {
      try {
        await workspaceConfig.update("ignore", ignoreList);
        console.log("Ignore list saved successfully.");
        window.showInformationMessage("Ignore list saved successfully.");
      } catch (error) {
        console.error("Error saving ignore list: ", error);
        window.showErrorMessage(
          "Failed to save ignore list. See console for details.",
        );
      }
    } else {
      window.showErrorMessage(
        "No configuration found or missing properties. Please configure LiveSync correctly.",
      );
    }
  }

  static async updateConfiguration(configuration: FullConfigurationMessage) {
    if (configuration.configuration) {
      this.saveRemoteServerConfiguration(configuration.configuration);
    }
    if (configuration.pairedFolders) {
      this.savePairFolders(configuration.pairedFolders);
    }
    if (configuration.fileEventActions) {
      this.saveFileEventActions(configuration.fileEventActions);
    }
    if (configuration.ignoreList) {
      this.saveIgnoreList(configuration.ignoreList);
    }
  }

  static async testConnection(
    configuration: ConfigurationMessage["configuration"],
  ): Promise<boolean> {
    const connectionManager = ConnectionManager.getInstance(configuration);
    try {
      await connectionManager.doSSHOperation(async (sshClient: SSHClient) => {
        await sshClient.waitForConnection();
      }, "Test Connection");

      window.showInformationMessage("Test connection successful.");
      return true;
    } catch (error: any) {
      return false;
    }
  }
}
