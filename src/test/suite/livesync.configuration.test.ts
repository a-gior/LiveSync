import * as vscode from "vscode";
import * as path from "path";
import * as assert from "assert";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("LiveSync Configuration Command Tests", () => {
  // let extensionContext: vscode.ExtensionContext;

  vscode.window.showInformationMessage(
    "Start LiveSync configuration command tests.",
  );

  suiteSetup(async function () {
    console.log("Suite Test Setup");

    const testWorkspace = path.resolve(
      __dirname,
      "../../out/src/test/workspace-test",
    );

    console.log("workspacePath: ", testWorkspace);
    // Ensure workspace is opened
    vscode.workspace.updateWorkspaceFolders(0, null, {
      uri: vscode.Uri.file(testWorkspace),
    });
  });

  test("TestConnection & Save Configuration", async () => {
    // Local VM credentials used for testing
    const configurationTest: ConfigurationMessage["configuration"] = {
      hostname: "192.168.1.18",
      port: 22,
      authMethod: "auth-password",
      username: "centos",
      password: "centos",
      sshKey: "",
    };

    // Test Connection
    const testResult =
      await ConfigurationPanel.testConnection(configurationTest);
    assert.equal(testResult, true, "Test Connection is KO");

    // Save Configuration
    const currentConfig = WorkspaceConfig.getAll();
    const baseConfig = {
      configuration: configurationTest,
      pairedFolders: [],
      fileEventActions: {
        actionOnUpload: "check&save",
        actionOnSave: "check&save",
        actionOnCreate: "create",
        actionOnDelete: "none",
        actionOnMove: "check&move",
      },
      ignoreList: [],
    };

    assert.deepEqual(
      currentConfig,
      baseConfig,
      "Initial Config isnt equal to the base config",
    );
    await ConfigurationPanel.saveRemoteServerConfiguration(configurationTest);

    const updatedConfig = WorkspaceConfig.getAll();
    assert.deepEqual(
      updatedConfig?.configuration,
      configurationTest,
      "Config is not updated",
    );

    await delay(5000); // 5 seconds delay
  });

  suiteTeardown(async () => {
    console.log("suiteTeardown");
  });
});
