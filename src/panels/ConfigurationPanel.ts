import { window, Uri, commands } from "vscode";
import { Panel } from "./Panel";

import { ConfigurationState } from "@shared/DTOs/states/ConfigurationState";
import { SFTPClient } from "../services/SFTPClient";
import { FullConfigurationMessage } from "@shared/DTOs/messages/FullConfigurationMessage";
import { FileEventActionsMessage } from "@shared/DTOs/messages/FileEventActionsMessage";
import { ConnectionManager } from "../managers/ConnectionManager";
import { IgnoreListMessage } from "../DTOs/messages/IgnoreListMessage";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";
import { LOG_FLAGS, logErrorMessage } from "../managers/LogManager";

export class ConfigurationPanel extends Panel {
  static render(extensionUri: Uri) {
    const viewType = "configurationViewType";
    const title = "Configuration";
    const localResourceRoots = [
      Uri.joinPath(extensionUri, "out"),
      Uri.joinPath(extensionUri, "resources"),
      Uri.joinPath(extensionUri, "webview-ui/public/build")
    ];
    const configurationCallback = async (message: FullConfigurationMessage) => {
      switch (message.command) {
        case "updateConfiguration":
          await this.updateConfiguration(message);
          break;
        case "testConnection":
          if (message.configuration) {
            await commands.executeCommand("livesync.testConnection", message.configuration);
          }
          break;
      }
    };

    const filepaths = [
      "resources/css/reset.css",
      "resources/css/vscode.css",
      "webview-ui/public/build/pages/configuration/configuration.css", // generated by compiling svelte with rollup
      "webview-ui/public/build/pages/configuration/configuration.js" // generated by compiling svelte with rollup
    ];

    // Call the render method from the parent class with additional parameters
    super.render(
      extensionUri,
      viewType,
      title,
      localResourceRoots,
      filepaths,
      configurationCallback
      // Additional options if needed
    );

    const allWorkspaceConfig: FullConfigurationMessage = {
      command: "setInitialConfiguration",
      ...WorkspaceConfigManager.getWorkspaceConfiguration()
    };
    this.currentPanel?.getPanel().webview.postMessage(allWorkspaceConfig);
  }

  static async saveRemotePath(remotePath: string) {
    const configuration = WorkspaceConfigManager.getRemoteServerConfigured();

    const connectionManager = ConnectionManager.getInstance(configuration);
    connectionManager
      .doSFTPOperation(async (sftpClient: SFTPClient) => {
        if (!(await sftpClient.pathExists(remotePath))) {
          logErrorMessage(`Remote path ${remotePath} does not exist`, LOG_FLAGS.ALL);
        }
      }, "Saving Remote path")
      .then(async () => {
        // All good so we update the remote path config
        await WorkspaceConfigManager.update("remotePath", remotePath);
      });
  }

  static async saveFileEventActions(actions: FileEventActionsMessage["actions"]) {
    if (actions) {
      await WorkspaceConfigManager.batchUpdate({
        actionOnUpload: actions.actionOnUpload,
        actionOnDownload: actions.actionOnDownload,
        actionOnSave: actions.actionOnSave,
        actionOnCreate: actions.actionOnCreate,
        actionOnDelete: actions.actionOnDelete,
        actionOnMove: actions.actionOnMove,
        actionOnOpen: actions.actionOnOpen
      });
    } else {
      window.showErrorMessage("No configuration found or missing properties. Please configure LiveSync correctly.");
      return;
    }
  }

  static async saveRemoteServerConfiguration(configuration: ConfigurationState["configuration"]): Promise<void> {
    if (configuration) {
      try {
        const testResult = await commands.executeCommand("livesync.testConnection", configuration);

        if (!testResult) {
          throw new Error("Test connection failed.");
        }

        const { hostname, port, username, authMethod, password, privateKeyPath, passphrase } = configuration;

        await WorkspaceConfigManager.batchUpdate({
          hostname,
          port,
          username,
          authMethod,
          password,
          privateKeyPath,
          passphrase
        });
      } catch (error) {
        logErrorMessage("Error saving remote server configuration: ", LOG_FLAGS.ALL, error);
      }
    } else {
      window.showErrorMessage("No configuration found or missing properties. Please configure LiveSync correctly.");
      return Promise.reject(new Error("Invalid configuration"));
    }
  }

  static async saveIgnoreList(ignoreList: IgnoreListMessage["ignoreList"]) {
    if (ignoreList) {
      try {
        await WorkspaceConfigManager.update("ignoreList", ignoreList);
      } catch (error) {
        console.error("Error saving ignore list: ", error);
        window.showErrorMessage("Failed to save ignore list. See console for details.");
      }
    } else {
      window.showErrorMessage("No configuration found or missing properties. Please configure LiveSync correctly.");
    }
  }

  static async updateConfiguration(configuration: FullConfigurationMessage) {
    if (configuration.configuration) {
      this.saveRemoteServerConfiguration(configuration.configuration);
    }
    if (configuration.remotePath) {
      this.saveRemotePath(configuration.remotePath);
    }
    if (configuration.fileEventActions) {
      this.saveFileEventActions(configuration.fileEventActions);
    }
    if (configuration.ignoreList) {
      this.saveIgnoreList(configuration.ignoreList);
    }
  }
}
