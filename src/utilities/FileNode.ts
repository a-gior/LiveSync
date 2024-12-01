import * as fs from "fs";
import * as path from "path";
import { getRemoteFileMetadata } from "./fileUtils/sftpOperations";
import {
  getRootFolderName,
  normalizePath,
  pathExists,
} from "./fileUtils/filePathUtils";
import { BaseNode, BaseNodeData, BaseNodeType } from "./BaseNode";
import { WorkspaceConfig } from "../services/WorkspaceConfig";
import { generateHash } from "./fileUtils/hashUtils";
import { LOG_FLAGS, logErrorMessage } from "../services/LogManager";

export enum FileNodeSource {
  remote = "remote",
  local = "local",
}

export interface FileNodeInfo {
  pairedFolderName: string;
  relativePath: string;
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
    pairedFolderNmae?: string,
    type?: BaseNodeType,
    size?: number,
    modifiedTime?: Date,
    fullPath?: string,
    source?: FileNodeSource,
  ) {
    if (typeof data === "string") {
      if (
        !data ||
        !pairedFolderNmae ||
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
      super(data, pairedFolderNmae, type, size, modifiedTime, fullPath);
      this.source = source;
      this.fullPath = fullPath;
      this.relativePath = getFileNodeInfo(fullPath)!.relativePath;
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

  static async getEntryFromLocalPath(localPath: string): Promise<FileNode> {
    try {
      const stats = fs.lstatSync(localPath);
      const nodeType = await pathExists(localPath, FileNodeSource.local);
      if (!nodeType) {
        logErrorMessage(
          `Could not find locally the specified file/folder at ${localPath}`,
          LOG_FLAGS.CONSOLE_AND_LOG_MANAGER,
        );
        throw new Error();
      }

      const fileNode = new FileNode({
        name: path.basename(localPath),
        pairedFolderName: await getRootFolderName(localPath),
        type: nodeType,
        size: stats.size,
        modifiedTime: stats.mtime,
        source: FileNodeSource.local,
        relativePath: getFileNodeInfo(localPath)!.relativePath,
        fullPath: localPath,
      });

      fileNode.hash = await generateHash(
        fileNode.fullPath,
        FileNodeSource.local,
        nodeType,
      );

      return fileNode;
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
        pairedFolderName: await getRootFolderName(remotePath),
        type: stats.isDirectory ? BaseNodeType.directory : BaseNodeType.file,
        size: stats.size,
        modifiedTime: new Date(stats.modifyTime * 1000),
        source: FileNodeSource.remote,
        relativePath: getFileNodeInfo(remotePath)!.relativePath,
        fullPath: remotePath,
      });
    } catch (error) {
      console.error(`Error getting FileNode for path ${remotePath}:`, error);
      throw error;
    }
  }
}

export function getFileNodeInfo(fullPath: string): FileNodeInfo {
  const pairedFolders = WorkspaceConfig.getPairedFoldersConfigured();
  const normalizedTargetPath = normalizePath(fullPath);

  for (const folder of pairedFolders) {
    if (normalizedTargetPath.startsWith(normalizePath(folder.localPath))) {
      return {
        pairedFolderName: path.basename(folder.localPath), // Directory name of the local path
        relativePath: path.relative(folder.localPath, fullPath),
      };
    }

    if (normalizedTargetPath.startsWith(normalizePath(folder.remotePath))) {
      return {
        pairedFolderName: path.basename(folder.remotePath), // Directory name of the remote path
        relativePath: path.relative(folder.remotePath, fullPath),
      };
    }
  }

  throw new Error(`Couldn't find FileNodeInfo of ${fullPath}`);
}
