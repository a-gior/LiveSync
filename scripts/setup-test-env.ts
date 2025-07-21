import * as fs from "fs-extra";
import * as path from "path";
import { DEFAULT_WORKSPACE_CONFIG } from "../src/utilities/constants";

const TEST_ROOT = path.resolve(__dirname, "../test/workspace-test");

const folders = [
  { name: "default", config: DEFAULT_WORKSPACE_CONFIG },
  { name: "folder-a", config: DEFAULT_WORKSPACE_CONFIG },
  { name: "folder-b", config: DEFAULT_WORKSPACE_CONFIG },
  { name: "broken-1", config: { ...DEFAULT_WORKSPACE_CONFIG, hostname: "" } }, // invalid config
  { name: "broken-2", config: {} as any } // malformed
];

const createWorkspace = async (folderNames: string[], fileName: string) => {
  const workspaceFile = {
    folders: folderNames.map(name => ({ path: `../${name}` })),
    settings: {}
  };
  const filePath = path.join(TEST_ROOT, ".code-workspaces", fileName);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, workspaceFile, { spaces: 2 });
};

async function run() {
  await fs.remove(TEST_ROOT);

  for (const { name, config } of folders) {
    const folderPath = path.join(TEST_ROOT, name, ".vscode");
    await fs.ensureDir(folderPath);

    // Write config
    await fs.writeJson(path.join(folderPath, "livesync.json"), config, { spaces: 2 });

    // Add sample + ignored files
    await fs.outputFile(path.join(TEST_ROOT, name, ".vscode", "ignored.txt"), "ignored content");
    await fs.outputFile(path.join(TEST_ROOT, name, "node_modules", "should-be-ignored.js"), "// dummy");
    await fs.outputFile(path.join(TEST_ROOT, name, "important.txt"), "hello");
  }

  // Create .code-workspace files inside test/workspace-test/.code-workspaces/
  await createWorkspace(["default"], "livesync-single.code-workspace");
  await createWorkspace(["folder-a", "folder-b"], "livesync-multi.code-workspace");
  await createWorkspace(["broken-1", "broken-2"], "livesync-broken.code-workspace");

  console.log("✅ Test workspaces and .code-workspace files generated in workspace-test/");
}

run();
