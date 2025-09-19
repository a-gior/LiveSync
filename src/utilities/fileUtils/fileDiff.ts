import * as path from "path";
import { workspace } from "vscode";
import { window, Uri, commands, WorkspaceFolder } from "vscode";
import { downloadRemoteFile } from "./sftpOperations";
import { getFullPaths } from "./filePathUtils";
import { ComparisonFileNode } from "../ComparisonFileNode";
import { configManager } from "../../extension";
import { listLocalFiles, listRemoteFiles } from "./fileListing";
import { TreeViewManager } from "../../managers/TreeViewManager";

export async function showDiff(input: ComparisonFileNode | { localPath: string; remotePath: string }) {
  let localPath: string;
  let remotePath: string;

  if (input instanceof ComparisonFileNode) {
    // If input is a ComparisonFileNode, extract paths using getFullPaths
    const fullPaths = await getFullPaths(input);
    localPath = fullPaths.localPath;
    remotePath = fullPaths.remotePath;
  } else {
    // If input is an object containing localPath and remotePath
    ({ localPath, remotePath } = input);
  }

  if (!localPath || !remotePath) {
    window.showErrorMessage(
      `No local or remote path found for ${input instanceof ComparisonFileNode ? input.relativePath : "provided paths"}`
    );
    return;
  }

  const tmpDir = path.join(__dirname, "..", "..", "tmp");
  const localTmpPath = path.join(tmpDir, path.basename(remotePath));

  await downloadRemoteFile(remotePath, localTmpPath);

  const localUri = Uri.file(localPath);
  const remoteUri = Uri.file(localTmpPath);

  await commands.executeCommand("vscode.diff", localUri, remoteUri, `${path.basename(localPath)} : Local ↔ Remote`);
}

export async function refreshDifferences(workspaceFolder: WorkspaceFolder) {
  
  const enabled = workspace
      .getConfiguration('livesync', workspaceFolder.uri)
      .get<boolean>('refreshOnConfigSave', true);
  if(!enabled)  {return;}

  const workspaceConfig = configManager!.getConfig(workspaceFolder.uri);
  const { localPath, remotePath } = workspaceConfig.getPathPair();
  const localFiles = await listLocalFiles(localPath);
  const remoteFiles = await listRemoteFiles(remotePath);
  
  const comparisonFileNode = ComparisonFileNode.compareFileNodes(localFiles, remoteFiles, workspaceConfig.jsonStore.comparisonFileRoot);
  workspaceConfig.jsonStore.comparisonFileRoot = comparisonFileNode;
  await TreeViewManager.diffProvider.refresh();
}