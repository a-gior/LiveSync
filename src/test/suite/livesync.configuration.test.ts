import * as vscode from "vscode";
import * as assert from "assert";
import { ConfigurationPanel } from "../../panels/ConfigurationPanel";
import { ConfigurationMessage } from "@shared/DTOs/messages/configurationDTO";

suite("LiveSync Configuration Command Tests", () => {
  vscode.window.showInformationMessage(
    "Start LiveSync configuration command tests.",
  );

  suiteSetup(async function () {
    console.log("suiteSetup");
  });

  test("Test Connection & Save Button", async () => {
    // Local VM credentials used for testing
    const configurationTest: ConfigurationMessage["configuration"] = {
      hostname: "192.168.56.101",
      port: 22,
      authMethod: "auth-password",
      username: "centos",
      password: "centos",
    };
    const testResult = ConfigurationPanel.testConnection(configurationTest);
    assert.equal(testResult, true, "Test Connection OK");

    // ConfigurationPanel.updateConfiguration(configurationTest);
  });

  suiteTeardown(async () => {
    console.log("suiteTeardown");
  });
});
