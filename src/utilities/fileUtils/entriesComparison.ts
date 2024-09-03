import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
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

    console.log(`<compareCorrespondingEntry> fileEntry: `, fileEntry);
    const localEntry = await listLocalFilesRecursive(localPath);
    const remoteEntry = await listRemoteFilesRecursive(remotePath);

    return ComparisonFileNode.compareFileNodes(localEntry, remoteEntry);
  } catch (error: any) {
    console.error("Error:", error);
    throw new Error(error.message);
  }
}
