import { FileNode } from "../FileNode";
import { loadFromFile } from "./fileOperations";
import {
  LOCAL_FILES_PATH,
  REMOTE_FILES_PATH,
  COMPARE_FILES_PATH,
} from "../constants";

async function loadFileNode(filePath: string): Promise<FileNode> {
  const data = await loadFromFile<any>(filePath);
  return new FileNode(data);
}

async function loadCompareFiles(
  filePath: string,
): Promise<Map<string, FileNode>> {
  const data = await loadFromFile<{ [key: string]: any }>(filePath);
  const entries = Object.entries(data).map(
    ([key, value]) => [key, new FileNode(value)] as [string, FileNode],
  );
  return new Map<string, FileNode>(entries);
}

// Export functions to load the specific files
async function loadLocalFiles(): Promise<FileNode> {
  return loadFileNode(LOCAL_FILES_PATH);
}

async function loadRemoteFiles(): Promise<FileNode> {
  return loadFileNode(REMOTE_FILES_PATH);
}

async function loadCompareFilesData(): Promise<Map<string, FileNode>> {
  return loadCompareFiles(COMPARE_FILES_PATH);
}

export { loadLocalFiles, loadRemoteFiles, loadCompareFilesData };
