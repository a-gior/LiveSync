import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";

import { WorkspaceConfigManager } from "../../src/managers/WorkspaceConfigManager";
import { DEFAULT_WORKSPACE_CONFIG } from "../../src/utilities/constants";
import { WorkspaceConfigFile } from "../../shared/DTOs/config/WorkspaceConfig";

export const TEST_ROOT = path.resolve(__dirname, "../workspace-test");
export let configManager: WorkspaceConfigManager;
export let context: vscode.ExtensionContext;

/**
 * Utility: delay execution
 */
export const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Initializes test workspace and loads configs.
 */
export async function initTestWorkspace(
  folderNames: string[],
  configOverride?: Partial<WorkspaceConfigFile>
): Promise<void> {
  await setupTestWorkspace(folderNames, configOverride);
  await openWorkspaceFolders(folderNames);

  const extension = vscode.extensions.getExtension("agior.livesync")!;
  const activated = await extension.activate();
  context = activated.context;

  configManager = new WorkspaceConfigManager(context);
  await configManager.loadConfigs();

  await wait(300); // let workspace settle
}

/**
 * Opens folders as workspace folders in VS Code.
 */
export async function openWorkspaceFolders(folderNames: string[]) {
  const folders: vscode.WorkspaceFolder[] = folderNames.map((name, index) => ({
    uri: vscode.Uri.file(path.join(TEST_ROOT, name)),
    name,
    index
  }));

  vscode.workspace.updateWorkspaceFolders(0, null, ...folders);
  await wait(300);
}

/**
 * Creates .vscode/livesync.json in each test folder
 */
export async function setupTestWorkspace(
  folderNames: string[],
  configOverride?: Partial<WorkspaceConfigFile>
) {
  for (const name of folderNames) {
    const folderPath = path.join(TEST_ROOT, name);
    const configPath = path.join(folderPath, ".vscode", "livesync.json");

    await fs.ensureDir(path.dirname(configPath));

    const finalConfig = {
      ...DEFAULT_WORKSPACE_CONFIG,
      ...configOverride
    };

    await fs.writeJson(configPath, finalConfig, { spaces: 2 });
  }
}

/**
 * Get URI of a folder by name in the current workspace
 */
export function getFolderUriByName(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.name === name);
  if (!folder) {throw new Error(`No folder named "${name}" found`);}
  return folder.uri;
}

/**
 * Get loaded config for a given folder name
 */
export function getWorkspaceConfig(folderName: string) {
  const uri = getFolderUriByName(folderName);
  return configManager.getConfig(uri);
}
