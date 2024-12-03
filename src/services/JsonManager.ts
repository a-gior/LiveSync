import path from "path";
import * as fs from "fs";
import { FileNode, getFileNodeInfo } from "../utilities/FileNode";
import {
  COMPARE_FILES_JSON,
  FOLDERS_STATE_JSON,
  REMOTE_FILES_JSON,
  SAVE_DIR,
} from "../utilities/constants";
import {
  ComparisonFileNode,
  ComparisonStatus,
} from "../utilities/ComparisonFileNode";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { debounce } from "../utilities/debounce";

export enum JsonType {
  REMOTE = "remote",
  COMPARE = "compare",
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
    } else {
      throw new Error("FoldersState wasn't loaded for some reasons");
    }
  }

  public async reloadFoldersState(): Promise<Map<string, boolean>> {
    this.foldersState = await this.loadMapFromJson<boolean>(FOLDERS_STATE_JSON);
    return this.foldersState;
  }

  public static getMapKey(element: ComparisonFileNode) {
    return `${element.pairedFolderName}$$${element.relativePath}`;
  }

  public async updateFolderState(
    element: ComparisonFileNode,
    isExpanded: boolean,
  ) {
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

  public async clearFoldersState(): Promise<void> {
    await this.waitForJsonLoad();
    if (!this.foldersState) {
      logErrorMessage("Couldn't clear folders state");
      return;
    }

    // Reset the in-memory map
    this.foldersState.clear();

    // Optionally save an empty state to the JSON file to clear the persisted state
    await this.saveMapToJson(FOLDERS_STATE_JSON, this.foldersState);
  }

  private async initializeJsonData(): Promise<void> {
    try {
      const [remote, comparison, foldersState] = await Promise.all([
        this.loadMapFromJson<FileNode>(REMOTE_FILES_JSON, FileNode),
        this.loadMapFromJson<ComparisonFileNode>(
          COMPARE_FILES_JSON,
          ComparisonFileNode,
        ),
        this.loadMapFromJson<boolean>(FOLDERS_STATE_JSON),
      ]);

      this.remoteFileEntries = remote;
      this.comparisonFileEntries = comparison;
      this.foldersState = foldersState;
    } catch (error) {
      logErrorMessage("Failed to initialize JSON data", LOG_FLAGS.ALL, error);
      throw error;
    }
  }

  public async waitForJsonLoad(): Promise<void> {
    return this.jsonLoadedPromise;
  }

  private async loadMapFromJson<T>(
    fileName: string,
    NodeConstructor?: new (data: any) => T,
  ): Promise<Map<string, T>> {
    const filePath = path.join(SAVE_DIR, fileName);
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
      throw new Error(
        `Failed to load node from JSON ${fileName}: ${error.message}`,
      );
    }
  }

  private async saveMapToJson<T>(
    fileName: string,
    dataMap: Map<string, T>,
  ): Promise<void> {
    const filePath = path.join(SAVE_DIR, fileName);

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
      throw new Error(
        `Failed to save map to JSON ${fileName}: ${error.message}`,
      );
    }
  }

  private async saveJson(
    fileName: string,
    data: Map<string, FileNode | ComparisonFileNode>,
  ): Promise<void> {
    const filePath = path.join(SAVE_DIR, fileName);
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
      [JsonType.COMPARE]: COMPARE_FILES_JSON,
    };
    return fileNames[jsonType];
  }

  public async getFileEntriesMap(
    jsonType: JsonType,
  ): Promise<Map<string, FileNode | ComparisonFileNode> | null> {
    await this.waitForJsonLoad();

    const entriesMap = {
      [JsonType.REMOTE]: this.remoteFileEntries,
      [JsonType.COMPARE]: this.comparisonFileEntries,
    };
    return entriesMap[jsonType];
  }

  public async updateRemoteFilesJson(fileNode: FileNode) {
    // Get the existing remote FileNode from JSON data
    const jsonType = JsonType.REMOTE;
    const fileName = this.getJsonFileName(jsonType);
    const fileNodeMap = await this.getFileEntriesMap(jsonType);

    if (!fileNodeMap) {
      logErrorMessage(
        `Unable to load existing remote files JSON data for ${fileName}`,
      );
      return;
    }

    const fileNodeInfo = getFileNodeInfo(fileNode.fullPath);
    const pathParts = fileNodeInfo.relativePath.split(path.sep);

    if (pathParts.length === 1 && pathParts[0] === "") {
      fileNodeMap.set(fileNodeInfo.pairedFolderName, fileNode);
    } else {
      if (fileNodeMap.has(fileNodeInfo.pairedFolderName)) {
        let currentNode = fileNodeMap.get(fileNodeInfo.pairedFolderName);

        for (const pathPart of pathParts) {
          if (!currentNode) {
            logErrorMessage(
              "<updateRemoteFilesJson> Couldnt find current node in remote files JSON",
            );
            return;
          }

          if (currentNode.children.has(pathPart)) {
            currentNode = currentNode.children.get(pathPart);
          } else {
            logErrorMessage(
              `<updateRemoteFilesJson> Couldn't find sub node in remote files JSON at ${fileNode.fullPath} for the path parts:`,
              LOG_FLAGS.CONSOLE_ONLY,
              pathParts,
            );
            return;
          }
        }

        if (currentNode) {
          Object.assign(currentNode, fileNode);
        }
      } else {
        fileNodeMap.set(fileNodeInfo.pairedFolderName, fileNode);
      }
    }

    // Save the merged data back to the JSON file
    await this.saveJson(fileName, fileNodeMap);
  }

  public async updateFullJson(
    jsonType: JsonType,
    data: Map<string, FileNode | ComparisonFileNode>,
  ): Promise<void> {
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

  private static async findNodeInHierarchy<
    T extends FileNode | ComparisonFileNode,
  >(
    targetPath: string,
    currentNode: T,
    pathParts: string[],
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

  public static async findEntryByPath<T extends FileNode | ComparisonFileNode>(
    filePath: string,
    rootEntries: Map<string, T>,
    pairedFolderName?: string,
  ): Promise<T | undefined> {
    if (!filePath || filePath === "." || filePath === "") {
      return pairedFolderName ? rootEntries.get(pairedFolderName) : undefined;
    }

    try {
      if (pairedFolderName) {
        const rootNode = rootEntries.get(pairedFolderName);
        if (!rootNode) {
          throw new Error(`Root node not found: ${pairedFolderName}`);
        }

        const pathParts = filePath.split(path.sep).filter(Boolean);
        return this.findNodeInHierarchy(filePath, rootNode, pathParts);
      }

      const fileNodeInfo = getFileNodeInfo(filePath);

      return this.findEntryByPath(
        fileNodeInfo.relativePath,
        rootEntries,
        fileNodeInfo.pairedFolderName,
      );
    } catch (error: any) {
      logErrorMessage(
        `Find entry failed: ${filePath}`,
        LOG_FLAGS.ALL,
        error.message,
      );
      return undefined;
    }
  }

  public static async addComparisonFileNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>,
  ): Promise<ComparisonFileNode> {
    try {
      const parentPath = path.dirname(element.relativePath);
      const parentNode = await this.findEntryByPath(
        parentPath,
        rootEntries,
        element.pairedFolderName,
      );

      if (!parentNode?.isDirectory()) {
        throw new Error(`Invalid parent: ${parentPath}`);
      }

      parentNode.addChild(element);

      return ComparisonFileNode.updateParentDirectoriesStatus(
        rootEntries,
        element,
      );
    } catch (error) {
      logErrorMessage("Add node failed", LOG_FLAGS.ALL, error);
      throw new Error("Adding node to rootElements failed");
    }
  }

  public static async deleteComparisonFileNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>,
  ): Promise<ComparisonFileNode> {
    try {
      const parentPath = path.dirname(element.relativePath);
      const parentNode = await this.findEntryByPath(
        parentPath,
        rootEntries,
        element.pairedFolderName,
      );

      if (!parentNode) {
        throw new Error(`Parent not found: ${parentPath}`);
      }

      parentNode.children.delete(element.name);

      const tempNode = new ComparisonFileNode(
        element.name,
        element.pairedFolderName,
        element.type,
        element.size,
        element.modifiedTime,
        element.relativePath,
        ComparisonStatus.removed,
      );

      return ComparisonFileNode.updateParentDirectoriesStatus(
        rootEntries,
        tempNode,
      );
    } catch (error: any) {
      logErrorMessage("Delete node failed", LOG_FLAGS.ALL, error.message);
      throw new Error("Deleting node to rootElements failed");
    }
  }

  public static async moveComparisonFileNode(
    element: ComparisonFileNode,
    newPath: string,
    rootEntries: Map<string, ComparisonFileNode>,
  ): Promise<ComparisonFileNode> {
    try {
      const [oldParentNode, newParentNode] = await Promise.all([
        this.findEntryByPath(
          path.dirname(element.relativePath),
          rootEntries,
          element.pairedFolderName,
        ),
        this.findEntryByPath(
          path.dirname(newPath),
          rootEntries,
          element.pairedFolderName,
        ),
      ]);

      if (!oldParentNode || !newParentNode) {
        throw new Error("Parent node not found");
      }

      oldParentNode.children.delete(element.name);
      element.relativePath = newPath;
      element.name = path.basename(newPath);
      element.setStatus(ComparisonStatus.modified);
      newParentNode.addChild(element);

      await ComparisonFileNode.updateParentDirectoriesStatus(
        rootEntries,
        oldParentNode,
      );
      return ComparisonFileNode.updateParentDirectoriesStatus(
        rootEntries,
        element,
      );
    } catch (error) {
      logErrorMessage("Move node failed", LOG_FLAGS.ALL, error);
      throw new Error("Moving node to rootElements failed");
    }
  }

  public static async updateComparisonFileNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>,
  ): Promise<ComparisonFileNode> {
    try {
      const foundElement = await this.findEntryByPath(
        element.relativePath,
        rootEntries,
        element.pairedFolderName,
      );

      if (!foundElement) {
        throw new Error("Element not found");
      }

      Object.assign(foundElement, element);
      return ComparisonFileNode.updateParentDirectoriesStatus(
        rootEntries,
        foundElement,
      );
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

export function isComparisonFileNodeMap(
  map: any,
): map is Map<string, ComparisonFileNode> {
  if (!(map instanceof Map)) {
    return false;
  }
  const firstValue = map.values().next().value;
  return firstValue instanceof ComparisonFileNode;
}
