import { FileEntry } from "../FileEntry";
import {
  listLocalFilesRecursive,
  listRemoteFilesRecursive,
} from "./fileListing";
import { saveToFile } from "./fileOperations";
import {
  LOCAL_FILES_PATH,
  REMOTE_FILES_PATH,
  COMPARE_FILES_PATH,
} from "../constants";

async function compareDirectories(
  localDir: string,
  remoteDir: string,
): Promise<Map<string, FileEntry>> {
  try {
    const localFiles = await listLocalFilesRecursive(localDir);
    const remoteFiles = await listRemoteFilesRecursive(remoteDir);
    const compareFiles = await FileEntry.compareDirectories(
      localFiles,
      remoteFiles,
    );

    await saveToFile(localFiles.toJSON(), LOCAL_FILES_PATH);
    await saveToFile(remoteFiles.toJSON(), REMOTE_FILES_PATH);
    await saveToFile(
      Object.fromEntries(compareFiles.entries()),
      COMPARE_FILES_PATH,
    );

    return compareFiles;
  } catch (error) {
    console.error("Error:", error);
    return new Map();
  }
}

export { compareDirectories };
