import JsonManager from "../../managers/JsonManager";
import { StatusBarManager } from "../../managers/StatusBarManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { listLocalFiles, listRemoteFiles } from "./fileListing";
import { getFullPaths } from "./filePathUtils";

export async function compareCorrespondingEntry(comparisonFileNode: ComparisonFileNode): Promise<ComparisonFileNode> {
  try {
    let { localPath, remotePath } = await getFullPaths(comparisonFileNode);

    const localEntry = comparisonFileNode.status !== ComparisonStatus.removed ? await listLocalFiles(localPath) : undefined;
    const remoteEntry = comparisonFileNode.status !== ComparisonStatus.added ? await listRemoteFiles(remotePath) : undefined;

    if (remoteEntry) {
      JsonManager.getInstance().updateRemoteFilesJson(remoteEntry);
    }

    return ComparisonFileNode.compareFileNodes(localEntry, remoteEntry);
  } catch (error: any) {
    StatusBarManager.showMessage("SFTP operation failed", "", "", 3000, "error");
    throw new Error(`<compareCorrespondingEntry> Error: ${error.message}`);
  }
}
