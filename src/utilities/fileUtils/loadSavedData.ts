import { FileEntry } from "../FileEntry";
import { loadFromFile } from "./fileOperations";
import {
  LOCAL_FILES_PATH,
  REMOTE_FILES_PATH,
  COMPARE_FILES_PATH,
} from "../constants";

async function loadFileEntry(filePath: string): Promise<FileEntry> {
  const data = await loadFromFile<any>(filePath);
  return FileEntry.fromJSON(data);
}

async function loadCompareFiles(
  filePath: string,
): Promise<Map<string, FileEntry>> {
  const data = await loadFromFile<{ [key: string]: any }>(filePath);
  const entries = Object.entries(data).map(
    ([key, value]) => [key, FileEntry.fromJSON(value)] as [string, FileEntry],
  );
  return new Map<string, FileEntry>(entries);
}

// Export functions to load the specific files
async function loadLocalFiles(): Promise<FileEntry> {
  return loadFileEntry(LOCAL_FILES_PATH);
}

async function loadRemoteFiles(): Promise<FileEntry> {
  return loadFileEntry(REMOTE_FILES_PATH);
}

async function loadCompareFilesData(): Promise<Map<string, FileEntry>> {
  return loadCompareFiles(COMPARE_FILES_PATH);
}

export { loadLocalFiles, loadRemoteFiles, loadCompareFilesData };
