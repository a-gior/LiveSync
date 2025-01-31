import * as vscode from "vscode";
import * as path from "path";
import { normalizePath } from "../../utilities/fileUtils/filePathUtils";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("LiveSync Custom Tests", () => {
  // let extensionContext: vscode.ExtensionContext;

  vscode.window.showInformationMessage("Start LiveSync Custom Tests.");

  suiteSetup(async function () {
    console.log("Suite Test Setup");

    const testWorkspace = path.resolve(__dirname, "../../out/src/test/workspace-test");

    console.log("workspacePath: ", testWorkspace);
    // Ensure workspace is opened
    vscode.workspace.updateWorkspaceFolders(0, null, {
      uri: vscode.Uri.file(testWorkspace)
    });
  });

  test("Custom Test", async () => {
    const path1 = normalizePath("/home/centos/test-workspace/Workspace/DEV/SPC-GESTUSER-DATA-DEV_SAVE_CALLBOT.rar");
    const path2 = normalizePath("Workspace\\DEV\\SPC-GESTUSER-DATA-DEV_SAVE_CALLBOT.rar");
    const relativePath = normalizePath(path.relative(path1, path2));
    console.log(`Relativepath from path1: ${path1} and path2: ${path2} => ${relativePath}`);

    await delay(5000); // 5 seconds delay
  });

  suiteTeardown(async () => {
    console.log("suiteTeardown");
  });
});
