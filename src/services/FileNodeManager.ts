import path from "path";
import * as fs from "fs";
import { FileNode, FileNodeSource, FileNodeType } from "../utilities/FileNode";
import {
  COMPARE_FILES_JSON,
  LOCAL_FILES_JSON,
  REMOTE_FILES_JSON,
  SAVE_DIR,
} from "../utilities/constants";
import { getRelativePath } from "../utilities/fileUtils/filePathUtils";
import { ComparisonFileNode } from "../utilities/ComparisonFileNode";

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
    this.localFileEntries = await this.loadJsonFromFile(LOCAL_FILES_JSON);
    // Load remoteFileEntries
    this.remoteFileEntries = await this.loadJsonFromFile(REMOTE_FILES_JSON);
    // Load comparisonFileEntries
    this.comparisonFileEntries =
      await this.loadJsonFromFile(COMPARE_FILES_JSON);
  }

  public async waitForJsonLoad(): Promise<void> {
    return this.jsonLoadedPromise;
  }

  private async loadJsonFromFile(
    fileName: string,
  ): Promise<Map<string, FileNode>> {
    const filePath = path.join(SAVE_DIR, fileName);
    let fileEntryMap = new Map<string, FileNode>();
    if (fs.existsSync(filePath)) {
      const fileContent = await fs.promises.readFile(filePath, "utf-8");
      const json = JSON.parse(fileContent);
      //   return new Map(Object.entries(JSON.parse(fileContent)));
      for (const entryName in json) {
        fileEntryMap.set(entryName, FileNode.fromJSON(json[entryName]));
      }
    }
    return fileEntryMap;
  }

  private async saveJsonToFile(
    fileName: string,
    data: Map<string, FileNode>,
  ): Promise<void> {
    const filePath = path.join(SAVE_DIR, fileName);
    const jsonContent = JSON.stringify(Object.fromEntries(data));
    await fs.promises.writeFile(filePath, jsonContent, "utf-8");
  }

  public getComparisonFileEntries(): Map<string, FileNode> | null {
    return this.comparisonFileEntries;
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

  private getFileEntriesMap(
    jsonType: JsonType,
  ): Map<string, ComparisonFileNode> | null {
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

  public async updateJsonFileNode(
    fileEntry: ComparisonFileNode,
    jsonType: JsonType,
  ): Promise<void> {
    await this.waitForJsonLoad();

    const fileEntriesMap = this.getFileEntriesMap(jsonType);
    const jsonFileName = this.getJsonFileName(jsonType);

    if (fileEntriesMap && jsonFileName) {
      const relativePath = fileEntry.relativePath;

      this.updateEntryInJson(
        fileEntriesMap,
        relativePath.split(path.sep),
        fileEntry,
      );
      await this.saveJsonToFile(jsonFileName, fileEntriesMap);
    }
  }

  private updateEntryInJson(
    fileEntriesMap: Map<string, ComparisonFileNode>,
    pathParts: string[],
    fileEntry: ComparisonFileNode,
  ): void {
    if (pathParts.length === 1 && pathParts[0] === "") {
      // Handle the case where the fileEntry is a root entry
      fileEntriesMap.set(fileEntry.name, fileEntry);
      return;
    }

    const currentPart = pathParts.shift();

    if (currentPart) {
      if (pathParts.length === 0) {
        fileEntriesMap.set(currentPart, fileEntry);
      } else {
        let currentEntry = fileEntriesMap.get(currentPart);
        if (!currentEntry) {
          currentEntry = new FileNode(
            currentPart,
            FileNodeType.directory,
            0,
            new Date(),
            FileNodeSource.local,
            path.join(fileEntry.fullPath, currentPart),
          );
          fileEntriesMap.set(currentPart, currentEntry);
        }
        if (currentEntry.isDirectory()) {
          this.updateEntryInJson(currentEntry.children, pathParts, fileEntry);
        }
      }
    }
  }
}
