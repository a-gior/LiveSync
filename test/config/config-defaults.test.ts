import * as assert from "assert";
import * as vscode from "vscode";
import { initTestWorkspace, configManager } from "../utils/test-utils";
import { DEFAULT_WORKSPACE_CONFIG } from "../../src/utilities/constants";

suite("LiveSync - Default Configuration", () => {
  suite("Single-root workspace", () => {
    suiteSetup(async () => {
      await initTestWorkspace(["default"]);
    });

    test("should load default config", () => {
      const folders = vscode.workspace.workspaceFolders!;
      assert.strictEqual(folders.length, 1, "Expected 1 folder in single-root workspace");

      const config = configManager.getConfig(folders[0].uri);
      assert.deepStrictEqual(config.ignoreList, DEFAULT_WORKSPACE_CONFIG.ignoreList);
    });
  });

  suite("Multi-root workspace", () => {
    suiteSetup(async () => {
      await initTestWorkspace(["folder-a", "folder-b"]);
    });

    test("should load default config for all folders", () => {
      const folders = vscode.workspace.workspaceFolders!;
      assert.strictEqual(folders.length, 2, "Expected 2 folders in multi-root workspace");

      for (const folder of folders) {
        const config = configManager.getConfig(folder.uri);
        assert.strictEqual(config.connectionSettings.hostname, DEFAULT_WORKSPACE_CONFIG.hostname);
      }
    });
  });
});
