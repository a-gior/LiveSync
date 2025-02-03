import JsonManager from "../../managers/JsonManager";
import { StatusBarManager } from "../../managers/StatusBarManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { listLocalFilesRecursive, listRemoteFilesRecursive } from "./fileListing";
import { getFullPaths } from "./filePathUtils";

export async function compareCorrespondingEntry(comparisonFileNode: ComparisonFileNode): Promise<ComparisonFileNode> {
  try {
    let { localPath, remotePath } = await getFullPaths(comparisonFileNode);

    const localEntry = comparisonFileNode.status !== ComparisonStatus.removed ? await listLocalFilesRecursive(localPath) : undefined;
    const remoteEntry = comparisonFileNode.status !== ComparisonStatus.added ? await listRemoteFilesRecursive(remotePath) : undefined;

    if (remoteEntry) {
      JsonManager.getInstance().updateRemoteFilesJson(remoteEntry);
    }

    return ComparisonFileNode.compareFileNodes(localEntry, remoteEntry);
  } catch (error: any) {
    StatusBarManager.showMessage("SFTP operation failed", "", "", 3000, "error");
    throw new Error(`<compareCorrespondingEntry> Error: ${error.message}`);
  }
}
