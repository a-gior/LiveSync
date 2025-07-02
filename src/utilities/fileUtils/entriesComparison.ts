import JsonManager from "../../managers/JsonManager";
import { ComparisonFileNode, ComparisonStatus } from "../ComparisonFileNode";
import { listLocalFiles, listRemoteFiles } from "./fileListing";
import { getFullPaths } from "./filePathUtils";

export async function compareCorrespondingEntry(comparisonFileNode: ComparisonFileNode): Promise<ComparisonFileNode> {
  let { localPath, remotePath } = await getFullPaths(comparisonFileNode);

  const localEntry = comparisonFileNode.status !== ComparisonStatus.removed ? await listLocalFiles(localPath) : undefined;
  const remoteEntry = comparisonFileNode.status !== ComparisonStatus.added ? await listRemoteFiles(remotePath) : undefined;

  if (remoteEntry) {
    JsonManager.getInstance().updateRemoteFilesJson(remoteEntry);
  }

  return ComparisonFileNode.compareFileNodes(localEntry, remoteEntry);
}
