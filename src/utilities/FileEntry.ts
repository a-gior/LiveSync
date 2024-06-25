import * as fs from "fs";
import * as path from "path";
import { getRemoteFileMetadata } from "./fileUtils/sftpOperations";
import { pathExists } from "./fileUtils/filePathUtils";

export enum FileEntryStatus {
  added = "added",
  removed = "removed",
  modified = "modified",
  unchanged = "unchanged",
  new = "new",
  deleted = "deleted",
}

export enum FileEntryType {
  file = "file",
  directory = "directory",
}

export enum FileEntrySource {
  remote = "remote",
  local = "local",
}

export class FileEntry {
  name: string;
  type: FileEntryType;
  size: number;
  modifiedTime: Date;
  source: FileEntrySource;
  status?: FileEntryStatus;
  children: Map<string, FileEntry>;
  fullPath: string;

  hash: string;

  constructor(
    name: string,
    type: FileEntryType,
    size: number,
    modifiedTime: Date,
    source: FileEntrySource,
    fullPath: string,
    status?: FileEntryStatus,
  ) {
    this.name = name;
    this.type = type;
    this.size = size;
    this.modifiedTime = modifiedTime;
    this.source = source;
    this.status = status;
    this.fullPath = fullPath;
    this.children = new Map<string, FileEntry>();

    // this.hash = generateHash(fullPath, source, type);
    this.hash = "";
  }

  updateStatus(newStatus: FileEntryStatus = FileEntryStatus.unchanged): void {
    this.status = newStatus;
  }

  addChild(child: FileEntry): void {
    // Update child's fullPath based on current fullPath and child's name
    this.children.set(child.name, child);
  }

  getChild(name: string): FileEntry | undefined {
    return this.children.get(name);
  }

  removeChild(name: string): boolean {
    return this.children.delete(name);
  }

  setChildren(children: Map<string, FileEntry> | { [key: string]: FileEntry }) {
    if (children instanceof Map) {
      this.children = children;
    } else {
      this.children = new Map(
        Object.entries(children).map(([key, value]) => [
          key,
          FileEntry.fromJSON(value),
        ]),
      );
    }
  }

  listChildren(): FileEntry[] {
    return Array.from(this.children.values());
  }

  isDirectory(): boolean {
    return this.type === FileEntryType.directory;
  }

  static fromJSON(json: any): FileEntry {
    const entry = new FileEntry(
      json.name,
      json.type,
      json.size,
      new Date(json.modifiedTime),
      json.source,
      json.fullPath,
      json.status,
    );
    entry.hash = json.hash;
    entry.setChildren(
      new Map(
        Object.entries(json.children).map(([key, value]) => [
          key,
          FileEntry.fromJSON(value),
        ]),
      ),
    );
    return entry;
  }

  toJSON(): any {
    return {
      name: this.name,
      type: this.type,
      size: this.size,
      modifiedTime: this.modifiedTime.toISOString(),
      source: this.source,
      status: this.status,
      fullPath: this.fullPath,
      hash: this.hash,
      children: Object.fromEntries(
        Array.from(this.children.entries()).map(([key, value]) => [
          key,
          value.toJSON(),
        ]),
      ),
    };
  }

  async exists() {
    return await pathExists(this.fullPath, this.source);
  }

  static getEntryFromLocalPath(localPath: string): FileEntry {
    try {
      const stats = fs.lstatSync(localPath);
      return new FileEntry(
        path.basename(localPath),
        stats.isDirectory() ? FileEntryType.directory : FileEntryType.file,
        stats.size,
        stats.mtime,
        FileEntrySource.local,
        localPath,
      );
    } catch (error) {
      console.error(`Error getting FileEntry for path ${localPath}:`, error);
      throw error;
    }
  }

  static async getEntryFromRemotePath(remotePath: string): Promise<FileEntry> {
    try {
      const stats = await getRemoteFileMetadata(remotePath);
      if (!stats) {
        throw new Error(`No metadata found for remote path: ${remotePath}`);
      }

      return new FileEntry(
        path.basename(remotePath),
        stats.isDirectory ? FileEntryType.directory : FileEntryType.file,
        stats.size,
        new Date(stats.modifyTime * 1000),
        FileEntrySource.remote,
        remotePath,
      );
    } catch (error) {
      console.error(`Error getting FileEntry for path ${remotePath}:`, error);
      throw error;
    }
  }
}
