import * as fs from "fs";
import * as path from "path";
import { getRemoteFileMetadata } from "./fileUtils/sftpOperations";
import { getRelativePath, pathType } from "./fileUtils/filePathUtils";
import { BaseNode, BaseNodeData, BaseNodeType } from "./BaseNode";
import { generateHash } from "./fileUtils/hashUtils";
import { LOG_FLAGS, logErrorMessage } from "../managers/LogManager";

export enum FileNodeSource {
  remote = "remote",
  local = "local"
}

export interface FileNodeData extends BaseNodeData {
  source: FileNodeSource;
  fullPath: string;
}

export class FileNode extends BaseNode<FileNode> {
  source: FileNodeSource;
  fullPath: string;

  constructor(
    data: FileNodeData | string,
    type?: BaseNodeType,
    size?: number,
    modifiedTime?: Date,
    fullPath?: string,
    source?: FileNodeSource
  ) {
    if (typeof data === "string") {
      if (!data || !type || size === undefined || !modifiedTime || !fullPath || !source) {
        throw new Error(
          `Missing parameters to instantiate FileNode. Required : data: ${data}, type: ${type}, size:  ${size}, modifiedTime:  ${modifiedTime}, fullPath:  ${fullPath}, source:  ${source} `
        );
      }

      // Traditional constructor parameters
      super(data, type, size, modifiedTime, fullPath);
      this.source = source;
      this.fullPath = fullPath;
      this.relativePath = getRelativePath(fullPath);
    } else {
      // JSON-like object initialization
      super(data);
      this.source = data.source;
      this.fullPath = data.fullPath;
      this.relativePath = data.relativePath;
    }
  }

  fromJSON(json: any): FileNode {
    return new FileNode(json);
  }

  toJSON(): any {
    const baseJson = super.toJSON();
    return {
      ...baseJson,
      source: this.source,
      fullPath: this.fullPath,
      hash: this.hash
    };
  }

  async exists() {
    return await pathType(this.fullPath, this.source);
  }

  static async createFileNodeFromLocalPath(localPath: string): Promise<FileNode> {
    try {
      const stats = fs.lstatSync(localPath);
      const nodeType = await pathType(localPath, FileNodeSource.local);
      if (!nodeType) {
        logErrorMessage(`Could not find locally the specified file/folder at ${localPath}`, LOG_FLAGS.CONSOLE_AND_LOG_MANAGER);
        throw new Error();
      }

      const fileNode = new FileNode({
        name: path.basename(localPath),
        type: nodeType,
        size: stats.size,
        modifiedTime: stats.mtime,
        source: FileNodeSource.local,
        relativePath: getRelativePath(localPath),
        fullPath: localPath,
        hash: ""
      });

      fileNode.hash = await generateHash(fileNode.fullPath, FileNodeSource.local, nodeType);

      return fileNode;
    } catch (error) {
      logErrorMessage(`Error getting FileNode for path ${localPath}:`);
      throw error;
    }
  }

  static async createFileNodeFromRemotePath(remotePath: string): Promise<FileNode> {
    try {
      const stats = await getRemoteFileMetadata(remotePath);
      if (!stats) {
        throw new Error(`No metadata found for remote path: ${remotePath}`);
      }

      return new FileNode({
        name: path.basename(remotePath),
        type: stats.isDirectory ? BaseNodeType.directory : BaseNodeType.file,
        size: stats.size,
        modifiedTime: new Date(stats.modifyTime * 1000),
        source: FileNodeSource.remote,
        relativePath: getRelativePath(remotePath),
        fullPath: remotePath,
        hash: ""
      });
    } catch (error) {
      logErrorMessage(`Error getting FileNode for path ${remotePath}:`);
      throw error;
    }
  }
}
