import * as assert from "assert";
import * as vscode from "vscode";

suite("Activation", () => {
  test("opens with a workspace", () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.ok(folders.length >= 1, "VS Code should open with a workspace");
  });

  test("single vs multi selection by env", () => {
    const ws = (process.env.LS_WS ?? "single").toLowerCase();
    const count = (vscode.workspace.workspaceFolders ?? []).length;
    if (ws === "multi") {assert.ok(count >= 2, "Expected multi-root workspace");}
    else {assert.equal(count, 1, "Expected single-root workspace");}
  });
});
