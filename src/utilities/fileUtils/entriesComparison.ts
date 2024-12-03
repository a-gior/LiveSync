import JsonManager from "../../services/JsonManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "./fileListing";
import { getFullPaths } from "./filePathUtils";

export async function compareCorrespondingEntry(
  fileEntry: ComparisonFileNode,
): Promise<ComparisonFileNode> {
  try {
    let { localPath, remotePath } = await getFullPaths(fileEntry);

    if (!localPath || !remotePath) {
      throw new Error(
        `Couldnt find remotePath or localPath of ${fileEntry.name} at ${fileEntry.relativePath}`,
      );
    }

    const localEntry =
      fileEntry.status !== ComparisonStatus.removed
        ? await listLocalFilesRecursive(localPath)
        : undefined;
    const remoteEntry =
      fileEntry.status !== ComparisonStatus.added
        ? await listRemoteFilesRecursive(remotePath)
        : undefined;

    if (remoteEntry) {
      console.log(
        "<compareCorrespondingEntry> Updating JSON REMOTE: ",
        remoteEntry,
      );
      JsonManager.getInstance().updateRemoteFilesJson(remoteEntry);
    }

    return ComparisonFileNode.compareFileNodes(localEntry, remoteEntry);
  } catch (error: any) {
    console.error("<compareCorrespondingEntry> Error:", error);
    throw new Error(error.message);
  }
}
