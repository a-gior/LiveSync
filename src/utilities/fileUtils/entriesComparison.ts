import JsonManager from "../../managers/JsonManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "./fileListing";
import { getFullPaths } from "./filePathUtils";

export async function compareCorrespondingEntry(
  comparisonFileNode: ComparisonFileNode,
): Promise<ComparisonFileNode> {
  try {
    let { localPath, remotePath } = await getFullPaths(comparisonFileNode);

    const localEntry =
      comparisonFileNode.status !== ComparisonStatus.removed
        ? await listLocalFilesRecursive(localPath)
        : undefined;
    const remoteEntry =
      comparisonFileNode.status !== ComparisonStatus.added
        ? await listRemoteFilesRecursive(remotePath)
        : undefined;

    if (remoteEntry) {
      JsonManager.getInstance().updateRemoteFilesJson(remoteEntry);
    }

    return ComparisonFileNode.compareFileNodes(localEntry, remoteEntry);
  } catch (error: any) {
    console.error("<compareCorrespondingEntry> Error:", error);
    throw new Error(error.message);
  }
}
