import { workspace } from "vscode";
import { generateHash } from "./fileUtils/hashUtils";

export enum FileEntryStatus {
  added = "added",
  removed = "removed",
  modified = "modified",
  unchanged = "unchanged",
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

    this.hash = generateHash(this.name, this.size, this.modifiedTime);
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

  setChildren(children: Map<string, FileEntry>) {
    this.children = children;
  }

  listChildren(): FileEntry[] {
    return Array.from(this.children.values());
  }

  isDirectory(): boolean {
    return this.type === FileEntryType.directory;
  }

  static compareDirectories(
    localRoot: FileEntry,
    remoteRoot: FileEntry,
  ): Map<string, FileEntry> {
    const root = new FileEntry(
      localRoot.name,
      FileEntryType.directory,
      localRoot.size,
      localRoot.modifiedTime,
      localRoot.source,
      localRoot.fullPath,
    );

    function recurse(
      localEntry: FileEntry | undefined,
      remoteEntry: FileEntry | undefined,
      parent: FileEntry,
    ) {
      parent.updateStatus(FileEntryStatus.unchanged);

      if (!localEntry && remoteEntry) {
        remoteEntry.updateStatus(FileEntryStatus.removed);
        parent.addChild(remoteEntry);
        parent.updateStatus(FileEntryStatus.modified);
        remoteEntry.children.forEach((child) =>
          recurse(undefined, child, remoteEntry),
        );
        return;
      }

      if (localEntry && !remoteEntry) {
        localEntry.updateStatus(FileEntryStatus.added);
        parent.addChild(localEntry);
        parent.updateStatus(FileEntryStatus.modified);
        localEntry.children.forEach((child) =>
          recurse(child, undefined, localEntry),
        );
        return;
      }

      if (localEntry && remoteEntry) {
        const currentEntry = new FileEntry(
          localEntry.name,
          localEntry.type,
          localEntry.size,
          localEntry.modifiedTime,
          localEntry.source,
          localEntry.fullPath,
        );

        console.log(
          `Comparing ${localEntry.name}/${localEntry.size}/${localEntry.modifiedTime} with ${remoteEntry.name}/${remoteEntry.size}/${remoteEntry.modifiedTime}`,
        );
        if (
          localEntry.isDirectory() &&
          remoteEntry.isDirectory() &&
          localEntry.name === remoteEntry.name
        ) {
          currentEntry.updateStatus(FileEntryStatus.unchanged);
        } else if (localEntry.hash !== remoteEntry.hash) {
          currentEntry.updateStatus(FileEntryStatus.modified);
          parent.updateStatus(FileEntryStatus.modified);
        } else {
          currentEntry.updateStatus(FileEntryStatus.unchanged);
        }

        const showUnchanged = workspace
          .getConfiguration("LiveSync")
          .get<boolean>("showUnchanged", true);
        // Only add the current file entry to the parent if currentEntry is not unchanged or if the showUnchanged flag is true
        if (
          !(
            showUnchanged === false &&
            currentEntry.status === FileEntryStatus.unchanged
          )
        ) {
          parent.addChild(currentEntry);
        }

        const allKeys = new Set([
          ...localEntry.children.keys(),
          ...remoteEntry.children.keys(),
        ]);
        allKeys.forEach((key) => {
          recurse(
            localEntry.children.get(key),
            remoteEntry.children.get(key),
            currentEntry,
          );
        });
      }
    }

    recurse(localRoot, remoteRoot, root);
    return root.children;
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
    entry.children = new Map(
      Object.entries(json.children).map(([key, value]) => [
        key,
        FileEntry.fromJSON(value),
      ]),
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
}
