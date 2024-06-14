import * as vscode from "vscode";
import * as assert from "assert";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { ConfigurationMessage } from "@shared/DTOs/messages/ConfigurationMessage";
import { WorkspaceConfig } from "../../services/WorkspaceConfig";

suite("LiveSync Configuration Command Tests", () => {
  // let extensionContext: vscode.ExtensionContext;

  vscode.window.showInformationMessage(
    "Start LiveSync configuration command tests.",
  );

  suiteSetup(async function () {
    console.log("suiteSetup");
  });

  test("TestConnection & Save Configuration", async () => {
    // Local VM credentials used for testing
    const configurationTest: ConfigurationMessage["configuration"] = {
      hostname: "192.168.56.101",
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
    const currentConfig = WorkspaceConfig.getInstance().getAll();
    assert.equal(currentConfig, null, "Initial Config isnt null");
    try {
      await ConfigurationPanel.saveRemoteServerConfiguration(configurationTest);
    } catch (err: any) {
      console.log("Error updating config: ", err.message);
    }
    const updatedConfig = WorkspaceConfig.getInstance().getAll();

    assert.deepEqual(
      updatedConfig?.configuration,
      configurationTest,
      "Config is not updated",
    );
  });

  suiteTeardown(async () => {
    console.log("suiteTeardown");
  });
});
