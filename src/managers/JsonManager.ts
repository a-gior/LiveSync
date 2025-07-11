import path from "path";
import * as fs from "fs";
import { FileNode, FileNodeSource } from "../utilities/FileNode";
import { COMPARE_FILES_JSON, FOLDERS_STATE_JSON, REMOTE_FILES_JSON, SAVE_DIR } from "../utilities/constants";
import { ComparisonFileNode, ComparisonStatus } from "../utilities/ComparisonFileNode";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { debounce } from "../utilities/debounce";
import { WorkspaceConfigManager } from "./WorkspaceConfigManager";
import { getCorrespondingPath, getRelativePath, splitParts } from "../utilities/fileUtils/filePathUtils";
import { Uri } from "vscode";
import { SyncTreeDataProvider } from "../services/SyncTreeDataProvider";

export enum JsonType {
  REMOTE = "remote",
  COMPARE = "compare"
}

export default class JsonManager {
  private static instance: JsonManager;
  private remoteFileEntries: Map<string, FileNode> | null = null;
  private comparisonFileEntries: Map<string, ComparisonFileNode> | null = null;
  private foldersState: Map<string, boolean> | null = null;
  private jsonLoadedPromise: Promise<void>;

  private constructor() {
    this.jsonLoadedPromise = this.initializeJsonData();
  }

  public static getInstance(): JsonManager {
    if (!JsonManager.instance) {
      JsonManager.instance = new JsonManager();
    }
    return JsonManager.instance;
  }

  public async getFoldersState(): Promise<Map<string, boolean>> {
    await this.waitForJsonLoad();

    if (this.foldersState) {
      return this.foldersState;
    }

    throw new Error("FoldersState wasn't loaded for some reasons");
  }

  public async reloadFoldersState(): Promise<Map<string, boolean>> {
    this.foldersState = await this.loadMapFromJson<boolean>(FOLDERS_STATE_JSON);
    return this.foldersState;
  }

  public static getMapKey(element: ComparisonFileNode) {
    return `${WorkspaceConfigManager.getWorkspaceBasename()}$$${element.relativePath}`;
  }

  public async updateFolderState(element: ComparisonFileNode, isExpanded: boolean) {
    await this.waitForJsonLoad();
    if (!this.foldersState) {
      logErrorMessage("Couldn't update folders state");
      return;
    }

    const mapKey = JsonManager.getMapKey(element);

    if (isExpanded) {
      this.foldersState.set(mapKey, isExpanded);
    } else {
      this.foldersState.delete(mapKey);
    }
    const saveMapToJsonDebounced = debounce(this.saveMapToJson, 500);
    saveMapToJsonDebounced(FOLDERS_STATE_JSON, this.foldersState);
  }

  /**
   * Recursively traverse each root element. If a node or any of its
   * descendants is changed, mark its folder as expanded.
   */
  public async expandChangedFoldersRecursive(treeDataProvider: SyncTreeDataProvider): Promise<void> {
    await this.waitForJsonLoad();
    
    const foldersState = new Map<string, boolean>();
    this.foldersState = foldersState;

    // Recurse bottom-up, returning true if subtree has a change
    const recurse = (node: ComparisonFileNode): boolean => {
      let hasChange = node.status !== ComparisonStatus.unchanged;

      if (node.isDirectory()) {
        for (const child of node.children.values()) {
          if (recurse(child)) {
            hasChange = true;
          }
        }
        // only mark expansion if there was a change somewhere below (or on this folder)
        if (hasChange) {
          const key = JsonManager.getMapKey(node);
          foldersState.set(key, true);
        }
      }

      return hasChange;
    };

    // Walk every root
    for (const root of treeDataProvider.rootElements.values()) {
      recurse(root);
    }

    // Persist all expansions in one go 
    await this.saveMapToJson(FOLDERS_STATE_JSON, this.foldersState);
  }

  public async clearFoldersState(): Promise<void> {
    await this.waitForJsonLoad();
    if (!this.foldersState) {
      logErrorMessage("Couldn't clear folders state");
      return;
    }

    // Reset the in-memory map
    this.foldersState.clear();

    await this.saveMapToJson(FOLDERS_STATE_JSON, this.foldersState);
  }

  private async initializeJsonData(): Promise<void> {
    try {
      const [remote, comparison, foldersState] = await Promise.all([
        this.loadMapFromJson<FileNode>(REMOTE_FILES_JSON, FileNode),
        this.loadMapFromJson<ComparisonFileNode>(COMPARE_FILES_JSON, ComparisonFileNode),
        this.loadMapFromJson<boolean>(FOLDERS_STATE_JSON)
      ]);

      this.remoteFileEntries = remote;
      this.comparisonFileEntries = comparison;
      this.foldersState = foldersState;
    } catch (error) {
      logErrorMessage("Failed to initialize JSON data", LOG_FLAGS.CONSOLE_ONLY, error);
      throw error;
    }
  }

  public async waitForJsonLoad(): Promise<void> {
    return this.jsonLoadedPromise;
  }

  private async loadMapFromJson<T>(fileName: string, NodeConstructor?: new (data: any) => T): Promise<Map<string, T>> {
    const filePath = getJsonPath(fileName);
    const fileEntryMap = new Map<string, T>();

    if (!fs.existsSync(filePath)) {
      return fileEntryMap;
    }

    try {
      const fileContent = await fs.promises.readFile(filePath, "utf-8");
      const json = JSON.parse(fileContent);

      if (NodeConstructor) {
        Object.entries(json).forEach(([entryName, entryData]) => {
          fileEntryMap.set(entryName, new NodeConstructor(entryData));
        });
      } else {
        Object.entries(json).forEach(([name, data]) => {
          fileEntryMap.set(name, data as T);
        });
      }

      return fileEntryMap;
    } catch (error: any) {
      throw new Error(`Failed to load node from JSON ${fileName}: ${error.message}`);
    }
  }

  private async saveMapToJson<T>(fileName: string, dataMap: Map<string, T>): Promise<void> {
    const filePath = getJsonPath(fileName);

    // Convert the Map to an Object to be saved as JSON
    const jsonObject: { [key: string]: T } = {};
    dataMap.forEach((value, key) => {
      jsonObject[key] = value;
    });

    try {
      // Write the JSON string to the specified file
      const jsonString = JSON.stringify(jsonObject, null, 2); // Pretty print with 2-space indentation for readability
      await fs.promises.writeFile(filePath, jsonString, "utf-8");
    } catch (error: any) {
      throw new Error(`Failed to save map to JSON ${fileName}: ${error.message}`);
    }
  }

  private async saveJson(fileName: string, data: Map<string, FileNode | ComparisonFileNode>): Promise<void> {
    const filePath = getJsonPath(fileName);
    const jsonContent = JSON.stringify(Object.fromEntries(data), null, 2);

    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, jsonContent, "utf-8");
    } catch (error: any) {
      throw new Error(`Failed to save JSON ${fileName}: ${error.message}`);
    }
  }

  private getJsonFileName(jsonType: JsonType): string {
    const fileNames = {
      [JsonType.REMOTE]: REMOTE_FILES_JSON,
      [JsonType.COMPARE]: COMPARE_FILES_JSON
    };
    return fileNames[jsonType];
  }

  public async getFileEntriesMap(jsonType: JsonType): Promise<Map<string, FileNode | ComparisonFileNode> | null> {
    await this.waitForJsonLoad();

    const entriesMap = {
      [JsonType.REMOTE]: this.remoteFileEntries,
      [JsonType.COMPARE]: this.comparisonFileEntries
    };
    return entriesMap[jsonType];
  }

  public async updateRemoteFilesJson(remoteNode: FileNode) {
    const jsonType    = JsonType.REMOTE;
    const fileName    = this.getJsonFileName(jsonType);
    const fileNodeMap = await this.getFileEntriesMap(jsonType);
    if (!fileNodeMap) {
      logErrorMessage(
        `<updateRemoteFilesJson> Unable to load existing remote files JSON data for ${fileName}`
      );
      return;
    }

    const rootName     = WorkspaceConfigManager.getWorkspaceBasename();
    const relativePath = getRelativePath(remoteNode.fullPath);
    const pathParts    = splitParts(relativePath);

    // 1) Replace the root node if we're at "."
    if (pathParts.length === 1 && pathParts[0] === '.') {
      fileNodeMap.set(rootName, remoteNode);
    } else {
      // 2) Look up the root entry
      let parent = fileNodeMap.get(rootName) as FileNode;
      if (!parent) {
        logErrorMessage(
          `<updateRemoteFilesJson> Root node "${rootName}" not found in ${fileName}`
        );
        return;
      }

      // 3) Descend to the immediate parent of remoteNode
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];

        if (!parent.children) {
          logErrorMessage(
            `<updateRemoteFilesJson> Missing children map on node "${parent.relativePath}" when looking for "${part}"`
          );
          return;
        }
        if (!parent.children.has(part)) {
          logErrorMessage(
            `<updateRemoteFilesJson> Path segment "${part}" not found under "${parent.relativePath}" for ${remoteNode.fullPath}`
          );
          return;
        }

        // non-null because of has()
        parent = parent.children.get(part)!;
      }

      // 4) Replace the target branch
      const branch = pathParts[pathParts.length - 1];
      parent.children.set(branch, remoteNode);
    }

    // 5) Persist the updated map
    try {
      await this.saveJson(fileName, fileNodeMap);
      logInfoMessage(`Updated JSON Remote files for ${remoteNode.relativePath}`);
    } catch (err: any) {
      logErrorMessage(`Failed saving JSON for ${fileName}: ${err.message}`);
    }
  }


  public async updateFullJson(jsonType: JsonType, data: Map<string, FileNode | ComparisonFileNode>): Promise<void> {
    try {
      // Get the existing JSON data
      const fileName = this.getJsonFileName(jsonType);
      const jsonData = await this.getFileEntriesMap(jsonType);

      if (!jsonData) {
        logErrorMessage(`Unable to load existing JSON data for ${fileName}`);
        return;
      }

      // Merge the new data into jsonData
      data.forEach((value, key) => {
        jsonData.set(key, value);
      });

      // Save the merged data back to the JSON file
      await this.saveJson(fileName, jsonData);

      logInfoMessage(`Successfully updated the full JSON for ${fileName}`);
    } catch (error) {
      logErrorMessage("Failed to update full JSON", LOG_FLAGS.ALL, error);
      throw error;
    }
  }

  private static async findNodeInHierarchy<T extends FileNode | ComparisonFileNode>(
    targetPath: string,
    currentNode: T,
    pathParts: string[]
  ): Promise<T | undefined> {
    if (pathParts.length === 0) {
      return currentNode;
    }

    if (!currentNode.isDirectory()) {
      return undefined;
    }

    const [currentPart, ...remainingParts] = pathParts;
    const childNode = currentNode.children.get(currentPart) as T;

    if (!childNode) {
      return undefined;
    }

    return this.findNodeInHierarchy(targetPath, childNode, remainingParts);
  }

  public static async findNodeByPath<T extends FileNode | ComparisonFileNode>(
    filePath: string,
    rootEntries: Map<string, T>,
    rootName?: string
  ): Promise<T | undefined> {
    if (!filePath || filePath === "." || filePath === "") {
      return rootName ? rootEntries.get(rootName) : undefined;
    }

    try {
      if (rootName) {
        const rootNode = rootEntries.get(rootName);
        if (!rootNode) {
          throw new Error(`Root node not found: ${rootName}`);
        }

        const pathParts = splitParts(filePath);
        return this.findNodeInHierarchy(filePath, rootNode, pathParts);
      }

      let rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
      const relativePath = getRelativePath(filePath);

      return this.findNodeByPath(relativePath, rootEntries, rootFolderName);
    } catch (error: any) {
      throw new Error(`Find entry failed: ${filePath}`);
    }
  }

  public static async findComparisonNodeFromUri(uri: Uri, treeDataProvider: SyncTreeDataProvider): Promise<ComparisonFileNode> {
    const relativePath = getRelativePath(uri.fsPath);
    const rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();

    const comparisonNode = await JsonManager.findNodeByPath(relativePath, treeDataProvider.rootElements, rootFolderName);

    if (!comparisonNode) {
      throw new Error(`Could not find file ${relativePath} in the comparison tree.`);
    }

    return comparisonNode;
  }

  public static async addComparisonFileNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>
  ): Promise<ComparisonFileNode> {
    try {
      let rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
      const parentPath = path.dirname(element.relativePath);
      const parentNode = await this.findNodeByPath(parentPath, rootEntries, rootFolderName);

      if (!parentNode?.isDirectory()) {
        throw new Error(`Invalid parent: ${parentPath}`);
      }

      parentNode.addChild(element);

      return await ComparisonFileNode.updateParentDirectoriesStatus(rootEntries, element);
    } catch (error: any) {
      logErrorMessage("Add node failed", LOG_FLAGS.ALL, error.message);
      throw new Error("Adding node to rootElements failed");
    }
  }

  public static async deleteComparisonFileNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>
  ): Promise<ComparisonFileNode> {
    try {
      let rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
      const parentPath = path.dirname(element.relativePath);
      const parentNode = await this.findNodeByPath(parentPath, rootEntries, rootFolderName);

      if (!parentNode) {
        throw new Error(`Parent not found: ${parentPath}`);
      }

      parentNode.children.delete(element.name);

      return await ComparisonFileNode.updateParentDirectoriesStatus(rootEntries, parentNode);
    } catch (error: any) {
      logErrorMessage("Delete node failed", LOG_FLAGS.ALL, error.message);
      throw new Error("Deleting node to rootElements failed");
    }
  }

  public static async updateComparisonFileNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>
  ): Promise<ComparisonFileNode> {
    try {
      let rootFolderName = WorkspaceConfigManager.getWorkspaceBasename();
      const foundElement = await this.findNodeByPath(element.relativePath, rootEntries, rootFolderName);

      if (!foundElement) {
        throw new Error("Element not found");
      }

      Object.assign(foundElement, element);
      return await ComparisonFileNode.updateParentDirectoriesStatus(rootEntries, foundElement);
    } catch (error: any) {
      logErrorMessage("Update node failed", LOG_FLAGS.ALL, error.message);
      throw new Error("Updating node to rootElements failed");
    }
  }
}

export function isFileNodeMap(map: any): map is Map<string, FileNode> {
  if (!(map instanceof Map)) {
    return false;
  }
  const firstValue = map.values().next().value;
  return firstValue instanceof FileNode;
}

export function isComparisonFileNodeMap(map: any): map is Map<string, ComparisonFileNode> {
  if (!(map instanceof Map)) {
    return false;
  }
  const firstValue = map.values().next().value;
  return firstValue instanceof ComparisonFileNode;
}

function getJsonPath(fileName: string): string {
  return path.join(SAVE_DIR, WorkspaceConfigManager.getWorkspaceHash().identifier, fileName);
}
