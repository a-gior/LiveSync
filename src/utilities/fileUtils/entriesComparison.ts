import FileNodeManager, { JsonType } from "../../services/FileNodeManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { FileNode } from "../FileNode";
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
        "<compareCorrespondingEntry> Saving JSON REMOTE: ",
        remoteEntry,
      );
      const remoteFilesMap = new Map<string, FileNode>();
      remoteFilesMap.set(remoteEntry.pairedFolderName, remoteEntry);
      await FileNodeManager.getInstance().updateFullJson(
        JsonType.REMOTE,
        remoteFilesMap,
      );
    }

    return ComparisonFileNode.compareFileNodes(localEntry, remoteEntry);
  } catch (error: any) {
    console.error("<compareCorrespondingEntry> Error:", error);
    throw new Error(error.message);
  }
}
