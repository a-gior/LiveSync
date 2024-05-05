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

import { ConfigurationMessage } from "./../ui/DTOs/messages/configurationDTO";
import { Client } from "ssh2";
import { SFTPClient } from "../services/SFTPClient";

export class ConfigurationPanel extends Panel {
  public static render(extensionUri: Uri) {
    const viewType = "configurationViewType";
    const title = "Configuration";
    const localResourceRoots = [
      Uri.joinPath(extensionUri, "out"),
      Uri.joinPath(extensionUri, "webview-ui/public/build"),
    ];
    const configurationCallback = (message: ConfigurationMessage) => {
      switch (message.command) {
        case "updateConfiguration":
          console.log("UpdateConfiguration...");
          this.updateConfiguration(message.configuration);
          break;
        case "testConnection":
          console.log("TestConnection...");
          this.testConnection(message.configuration);
          break;
      }
    };
    const filepaths = [
      "webview-ui/public/build/pages/configuration/configuration.css",
      "webview-ui/public/build/pages/configuration/configuration.js",
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
  }

  static updateConfiguration(
    configuration: ConfigurationMessage["configuration"],
  ) {
    const config = workspace.getConfiguration("LiveSync");
    const { hostname, port, username, authMethod, password, sshKey } =
      configuration;

    config.update("hostname", hostname, ConfigurationTarget.Workspace);
    config.update("port", port, ConfigurationTarget.Workspace);
    config.update("username", username, ConfigurationTarget.Workspace);
    config.update("authMethod", authMethod, ConfigurationTarget.Workspace);
    config.update("password", password, ConfigurationTarget.Workspace);
    config.update("sshKey", sshKey, ConfigurationTarget.Workspace);

    console.log("Updated config: ", config);
  }

  static async testConnection(
    configuration: ConfigurationMessage["configuration"],
  ): Promise<void> {
    // Function to connect via SSH
    function connectSSH(config: ConfigurationMessage["configuration"]): void {
      const conn = new Client();

      conn.on("ready", () => {
        console.log("SSH Connection successful");
        conn.end();
      });
      conn.on("error", (err) => {
        console.error("Error connecting via SSH:", err);
      });
      conn.connect(config);
    }

    const { hostname, port, username, password } = configuration;
    // Test SSH connection
    // connectSSH(configuration);

    // Test SFTP connection
    //* Open the connection
    const client = new SFTPClient();
    await client.connect(configuration);

    const clientErrors = client.getErrors();
    if (clientErrors.length > 0) {
      window.showErrorMessage(clientErrors[0].error.message);
    } else {
      window.showInformationMessage("Test Connection successful");
    }

    // //* List working directory files
    // await client.listFiles(".");

    // //* Upload local file to remote file
    // await client.uploadFile("./local.txt", "./remote.txt");

    // //* Download remote file to local file
    // await client.downloadFile("./remote.txt", "./download.txt");

    // //* Delete remote file
    // await client.deleteFile("./remote.txt");

    //* Close the connection
    await client.disconnect();
  }
}
