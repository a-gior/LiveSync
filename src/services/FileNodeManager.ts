import path from "path";
import * as fs from "fs";
import { FileNode, FileNodeData } from "../utilities/FileNode";
import {
  COMPARE_FILES_JSON,
  LOCAL_FILES_JSON,
  REMOTE_FILES_JSON,
  SAVE_DIR,
} from "../utilities/constants";
import { ComparisonFileData, ComparisonFileNode } from "../utilities/ComparisonFileNode";
import { LOG_FLAGS, logErrorMessage, logInfoMessage } from "./LogManager";

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
    this.localFileEntries = await this.loadFileNodeFromJson(LOCAL_FILES_JSON);
    // Load remoteFileEntries
    this.remoteFileEntries = await this.loadFileNodeFromJson(REMOTE_FILES_JSON);
    // Load comparisonFileEntries
    this.comparisonFileEntries =
      await this.loadComparisonFileNodeFromJson(COMPARE_FILES_JSON);
  }

  public async waitForJsonLoad(): Promise<void> {
    return this.jsonLoadedPromise;
  }

  private async loadFileNodeFromJson(
    fileName: string,
  ): Promise<Map<string, FileNode>> {
    const filePath = path.join(SAVE_DIR, fileName);
    let fileEntryMap = new Map<string, FileNode>();
    if (fs.existsSync(filePath)) {
      const fileContent = await fs.promises.readFile(filePath, "utf-8");
      const json: FileNodeData = JSON.parse(fileContent);
      //   return new Map(Object.entries(JSON.parse(fileContent)));
      for (const entryName in json) {
        fileEntryMap.set(entryName, new FileNode(json));
      }
    }

    return fileEntryMap;
  }

  private async loadComparisonFileNodeFromJson(
    fileName: string,
  ): Promise<Map<string, ComparisonFileNode>> {
    const filePath = path.join(SAVE_DIR, fileName);
    let fileEntryMap = new Map<string, ComparisonFileNode>();
    if (fs.existsSync(filePath)) {
      const fileContent = await fs.promises.readFile(filePath, "utf-8");
      const json: ComparisonFileData = JSON.parse(fileContent);
      //   return new Map(Object.entries(JSON.parse(fileContent)));
      for (const entryName in json) {
        fileEntryMap.set(entryName, new ComparisonFileNode(json));
      }
    }

    return fileEntryMap;
  }

  private async saveJson(
    fileName: string,
    data: Map<string, FileNode|ComparisonFileNode>,
  ): Promise<void> {
    const filePath = path.join(SAVE_DIR, fileName);
    const jsonContent = JSON.stringify(Object.fromEntries(data));
    await fs.promises.writeFile(filePath, jsonContent, "utf-8");
  }

  public getComparisonFileEntries(): Map<string, ComparisonFileNode> | null {
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
  ): Map<string, ComparisonFileNode|FileNode> | null {
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

  public async updateFullJson(jsonType: JsonType, data: Map<string, FileNode|ComparisonFileNode>) {
    const fileName = this.getJsonFileName(jsonType);
    this.saveJson(fileName, data);
  }

  public async updateJsonFileNode(
    fileEntry: ComparisonFileNode | FileNode,
    jsonType: JsonType,
  ): Promise<void> {
    try {
      await this.waitForJsonLoad();
  
      const fileEntriesMap = this.getFileEntriesMap(jsonType);
      const jsonFileName = this.getJsonFileName(jsonType);
  
      if (!fileEntriesMap || !jsonFileName) {
        logErrorMessage("File entries map or JSON file name is undefined.");
        return;
      }
  
      let entryUpdated = false;
      fileEntriesMap.forEach((value, key, map) => {
        if (fileEntry.relativePath === value.relativePath && fileEntry.name === value.name) {
          map.set(key, fileEntry);
          entryUpdated = true;
        }
      });
  
      if (!entryUpdated) {
        logInfoMessage(`No matching entry found for ${fileEntry.name} in ${jsonFileName}.`);
      }
  
      await this.saveJson(jsonFileName, fileEntriesMap);
      logInfoMessage(`Successfully updated ${fileEntry.name} in ${jsonFileName}.`);
    } catch (error) {
      logErrorMessage("Error updating JSON file node", LOG_FLAGS.ALL, error);
    }
  }  
}
