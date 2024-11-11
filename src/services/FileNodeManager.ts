import path from "path";
import * as fs from "fs";
import { FileNode, getFileNodeInfo } from "../utilities/FileNode";
import {
  COMPARE_FILES_JSON,
  LOCAL_FILES_JSON,
  REMOTE_FILES_JSON,
  SAVE_DIR,
} from "../utilities/constants";
import {
  ComparisonFileData,
  ComparisonFileNode,
} from "../utilities/ComparisonFileNode";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";
import { getFullPaths } from "../utilities/fileUtils/filePathUtils";

export enum JsonType {
  LOCAL = "local",
  REMOTE = "remote",
  COMPARE = "compare",
}

export default class FileNodeManager {
  private static instance: FileNodeManager;
  private localFileEntries: Map<string, FileNode> | null = null;
  private remoteFileEntries: Map<string, FileNode> | null = null;
  private comparisonFileEntries: Map<string, ComparisonFileNode> | null = null;
  private jsonLoadedPromise: Promise<void>;

  private constructor() {
    this.jsonLoadedPromise = this.loadJsonData();
  }

  public static getInstance(): FileNodeManager {
    if (!FileNodeManager.instance) {
      FileNodeManager.instance = new FileNodeManager();
    }
    return FileNodeManager.instance;
  }

  private async loadJsonData(): Promise<void> {
    // Load localFileEntries
    this.localFileEntries = await this.loadNodeFromJson<FileNode>(
      LOCAL_FILES_JSON,
      FileNode,
    );
    // Load remoteFileEntries
    this.remoteFileEntries = await this.loadNodeFromJson<FileNode>(
      REMOTE_FILES_JSON,
      FileNode,
    );
    // Load comparisonFileEntries
    this.comparisonFileEntries =
      await this.loadNodeFromJson<ComparisonFileNode>(
        COMPARE_FILES_JSON,
        ComparisonFileNode,
      );
  }

  public async waitForJsonLoad(): Promise<void> {
    return this.jsonLoadedPromise;
  }

  private async loadNodeFromJson<T>(
    fileName: string,
    NodeConstructor: new (data: any) => T,
  ): Promise<Map<string, T>> {
    const filePath = path.join(SAVE_DIR, fileName);
    const fileEntryMap = new Map<string, T>();

    if (fs.existsSync(filePath)) {
      try {
        const fileContent = await fs.promises.readFile(filePath, "utf-8");
        const json = JSON.parse(fileContent);

        for (const entryName in json) {
          if (json.hasOwnProperty(entryName)) {
            const entryData = json[entryName];
            // Properly instantiate a new Node from the JSON data using the provided constructor
            fileEntryMap.set(entryName, new NodeConstructor(entryData));
          }
        }
      } catch (error) {
        logErrorMessage(
          `Failed to load node from JSON: ${fileName}`,
          LOG_FLAGS.ALL,
          error,
        );
      }
    }

    return fileEntryMap;
  }

  private async loadComparisonFileNodeFromJson(
    fileName: string,
  ): Promise<Map<string, ComparisonFileNode>> {
    const filePath = path.join(SAVE_DIR, fileName);
    const fileEntryMap = new Map<string, ComparisonFileNode>();

    if (fs.existsSync(filePath)) {
      try {
        const fileContent = await fs.promises.readFile(filePath, "utf-8");
        const json = JSON.parse(fileContent);

        for (const entryName in json) {
          if (json.hasOwnProperty(entryName)) {
            const entry: ComparisonFileData = json[entryName];
            fileEntryMap.set(entryName, new ComparisonFileNode(entry));
          }
        }
      } catch (error) {
        logErrorMessage(
          `Failed to load comparison file node from JSON`,
          LOG_FLAGS.ALL,
          error,
        );
      }
    }

    return fileEntryMap;
  }

  private async saveJson(
    fileName: string,
    data: Map<string, FileNode | ComparisonFileNode>,
  ): Promise<void> {
    const filePath = path.join(SAVE_DIR, fileName);
    const jsonContent = JSON.stringify(Object.fromEntries(data));
    await fs.promises.writeFile(filePath, jsonContent, "utf-8");
  }

  private getJsonFileName(jsonType: JsonType): string {
    switch (jsonType) {
      case JsonType.LOCAL:
        return LOCAL_FILES_JSON;
      case JsonType.REMOTE:
        return REMOTE_FILES_JSON;
      case JsonType.COMPARE:
      default:
        return COMPARE_FILES_JSON;
    }
  }

  public async getFileEntriesMap(
    jsonType: JsonType,
  ): Promise<Map<string, FileNode | ComparisonFileNode> | null> {
    await this.loadJsonData();

    switch (jsonType) {
      case JsonType.LOCAL:
        return this.localFileEntries;
      case JsonType.REMOTE:
        return this.remoteFileEntries;
      case JsonType.COMPARE:
      default:
        return this.comparisonFileEntries;
    }
  }

  public async updateFullJson(
    jsonType: JsonType,
    data: Map<string, FileNode | ComparisonFileNode>,
  ) {
    const fileName = this.getJsonFileName(jsonType);
    this.saveJson(fileName, data);
  }

  public async updateJsonFileNode(
    fileEntry: ComparisonFileNode | FileNode,
    jsonType: JsonType,
  ): Promise<void> {
    try {
      const fileEntriesMap = await this.getFileEntriesMap(jsonType);
      const jsonFileName = this.getJsonFileName(jsonType);

      if (!fileEntriesMap || !jsonFileName) {
        logErrorMessage("File entries map or JSON file name is undefined.");
        return;
      }

      let entryUpdated = false;

      // Recursive function to find and update the matching entry in the hierarchy
      const updateEntryRecursively = (
        targetEntry: ComparisonFileNode | FileNode,
        currentEntries: Map<string, ComparisonFileNode | FileNode>,
      ): boolean => {
        for (const [key, currentEntry] of currentEntries.entries()) {
          if (
            targetEntry.relativePath === currentEntry.relativePath &&
            targetEntry.name === currentEntry.name
          ) {
            // Update the entry
            currentEntries.set(key, targetEntry);
            return true;
          }

          // If the current entry is a directory, recursively search its children
          if (currentEntry.isDirectory()) {
            const childrenUpdated = updateEntryRecursively(
              targetEntry,
              currentEntry.children as Map<
                string,
                ComparisonFileNode | FileNode
              >,
            );
            if (childrenUpdated) {
              return true;
            }
          }
        }
        return false;
      };

      // Start the recursive update from the root entries
      entryUpdated = updateEntryRecursively(fileEntry, fileEntriesMap);

      if (!entryUpdated) {
        logInfoMessage(
          `No matching entry found for ${fileEntry.name} in ${jsonFileName}.`,
        );
      }

      console.log(
        `<updateJsonFileNode> Saving JSON: ${jsonFileName}`,
        fileEntriesMap,
      );
      await this.saveJson(jsonFileName, fileEntriesMap);
      logInfoMessage(
        `Successfully updated ${fileEntry.name} in ${jsonFileName}.`,
      );
    } catch (error) {
      logErrorMessage("Error updating JSON file node", LOG_FLAGS.ALL, error);
    }
  }

  /**
   * Finds an entry using a ComparisonFileNode object directly.
   * If the element is a root element (i.e., empty relativePath), it compares its name against the rootElements.
   * @param element The ComparisonFileNode object to find.
   * @param rootEntries The root elements map (from TreeDataProvider).
   * @returns The found ComparisonFileNode or undefined if not found.
   */
  static async findEntryByNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>,
  ): Promise<ComparisonFileNode | undefined> {
    if (!element.relativePath) {
      // If no relativePath, check by name in rootElements
      for (const rootEntry of rootEntries.values()) {
        if (rootEntry.name === element.pairedFolderName) {
          return rootEntry;
        }
      }
      return undefined;
    }

    const { localPath, remotePath } = await getFullPaths(element);
    const fullPath = localPath ?? remotePath;
    if (!fullPath) {
      throw new Error(
        `Couldn't find a local or remote path for ${element.relativePath}`,
      );
    }

    // If relativePath exists, use the findEntryByPath method
    return this.findEntryByPath(fullPath, rootEntries);
  }

  /**
   * Finds a ComparisonFileNode using a relative or absolute path.
   * @param filePath The full path of the node to find.
   * @param rootEntries The root elements map (from TreeDataProvider).
   * @param isPathRelative Whether the filePath is relative.
   * @returns The found ComparisonFileNode or undefined if not found.
   */
  static findEntryByPath<T extends ComparisonFileNode | FileNode>(
    filePath: string,
    rootEntries: Map<string, T>,
  ): T | undefined {
    const fileNodeInfo = getFileNodeInfo(filePath);
    if (!fileNodeInfo) {
      logErrorMessage(
        `<findEntryByPath> Couldnt get FileNodeInfo for ${filePath}`,
      );
      return undefined;
    }

    const relativePath = fileNodeInfo.relativePath;
    if (!relativePath) {
      return undefined;
    }

    const pathParts = [
      ...(fileNodeInfo ? [fileNodeInfo.pairedFolderName] : []),
      ...relativePath.split(path.sep),
    ];
    let currentEntries = rootEntries;
    let foundEntry: T | undefined;

    // Traverse through path parts
    for (const part of pathParts) {
      foundEntry = currentEntries.get(part);
      if (!foundEntry) {
        return undefined;
      }

      // If we've reached the last part of the path, return the found entry
      if (part === pathParts[pathParts.length - 1]) {
        return foundEntry;
      }

      if (foundEntry.isDirectory()) {
        currentEntries = foundEntry.children as Map<string, T>;
      } else {
        break; // Stop if it's a file before reaching the last part
      }
    }

    return foundEntry;
  }

  /**
   * Updates the found ComparisonFileNode with the data from the element passed.
   * @param element The updated element.
   * @param rootEntries The root elements map (from TreeDataProvider).
   */
  static async updateComparisonFileNode(
    element: ComparisonFileNode,
    rootEntries: Map<string, ComparisonFileNode>,
  ): Promise<ComparisonFileNode | FileNode | undefined> {
    const foundElement = await this.findEntryByNode(element, rootEntries);

    if (foundElement) {
      Object.assign(foundElement, element); // Updates the found element with new data
      return foundElement;
    }

    logErrorMessage(
      "<updateComparisonFileNode> Element not found in the root elements",
      LOG_FLAGS.ALL,
      rootEntries,
    );
    return undefined;
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
