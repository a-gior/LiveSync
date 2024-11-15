import FileNodeManager, { JsonType } from "../../services/FileNodeManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { FileNode } from "../FileNode";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "./fileListing";
import { getCorrespondingPath, getFullPaths } from "./filePathUtils";

export async function compareCorrespondingEntry(
  fileEntry: ComparisonFileNode,
): Promise<ComparisonFileNode> {
  try {
    let { localPath, remotePath } = await getFullPaths(fileEntry);

    switch (fileEntry.status) {
      case ComparisonStatus.added:
        remotePath = getCorrespondingPath(localPath!);
        break;
      case ComparisonStatus.removed:
        localPath = getCorrespondingPath(remotePath!);
        break;
    }

    if (!localPath || !remotePath) {
      throw new Error(
        `Couldnt find remotePath or localPath of ${fileEntry.name} at ${fileEntry.relativePath}`,
      );
    }

    const localEntry = await listLocalFilesRecursive(localPath);
    const remoteEntry = await listRemoteFilesRecursive(remotePath);
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
