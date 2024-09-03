import * as fs from "fs";
import * as path from "path";
import { getRemoteFileMetadata } from "./fileUtils/sftpOperations";
import { getRelativePath, pathExists } from "./fileUtils/filePathUtils";
import { BaseNode, BaseNodeData, BaseNodeType } from "./BaseNode";

export enum FileNodeSource {
  remote = "remote",
  local = "local",
}

export interface FileNodeData extends BaseNodeData {
  source: FileNodeSource;
  fullPath: string;
  hash?: string;
}

export class FileNode extends BaseNode<FileNode> {
  source: FileNodeSource;
  fullPath: string;
  hash?: string;

  constructor(
    data: FileNodeData | string,
    type?: BaseNodeType,
    size?: number,
    modifiedTime?: Date,
    fullPath?: string,
    source?: FileNodeSource,
  ) {
    if (typeof data === "string") {
      if (
        !data ||
        !type ||
        size === undefined ||
        !modifiedTime ||
        !fullPath ||
        !source
      ) {
        throw new Error(
          `Missing parameters to instantiate FileNode. Required : data: ${data}, type: ${type}, size:  ${size}, modifiedTime:  ${modifiedTime}, fullPath:  ${fullPath}, source:  ${source} `,
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
      this.hash = data.hash;
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
      hash: this.hash,
    };
  }

  async exists() {
    return await pathExists(this.fullPath, this.source);
  }

  static getEntryFromLocalPath(localPath: string): FileNode {
    try {
      const stats = fs.lstatSync(localPath);

      return new FileNode({
        name: path.basename(localPath),
        type: stats.isDirectory() ? BaseNodeType.directory : BaseNodeType.file,
        size: stats.size,
        modifiedTime: stats.mtime,
        source: FileNodeSource.local,
        relativePath: getRelativePath(localPath),
        fullPath: localPath,
      });
    } catch (error) {
      console.error(`Error getting FileNode for path ${localPath}:`, error);
      throw error;
    }
  }

  static async getEntryFromRemotePath(remotePath: string): Promise<FileNode> {
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
      });
    } catch (error) {
      console.error(`Error getting FileNode for path ${remotePath}:`, error);
      throw error;
    }
  }
}
