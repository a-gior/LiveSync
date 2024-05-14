import * as crypto from "crypto";

export enum FileEntryStatus {
  added,
  removed,
  modified,
  unchanged,
}

export enum FileEntryType {
  file,
  directory,
}

export enum FileEntrySource {
  remote,
  local,
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

    this.hash = this.generateHash();
  }

  updateStatus(newStatus: FileEntryStatus = FileEntryStatus.unchanged): void {
    this.status = newStatus;
  }

  addChild(child: FileEntry): void {
    // Update child's fullPath based on current fullPath and child's name
    child.fullPath = `${this.fullPath}/${child.name}`;
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

  generateHash(): string {
    const hash = crypto.createHash("sha256");
    hash.update(`${this.name}${this.size}${this.modifiedTime.toISOString()}`); // Using ISO string for consistent date formatting
    return hash.digest("hex");
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
      if (!localEntry && remoteEntry) {
        remoteEntry.updateStatus(FileEntryStatus.added);
        parent.addChild(remoteEntry);
        remoteEntry.children.forEach((child) =>
          recurse(undefined, child, remoteEntry),
        );
        return;
      }

      if (localEntry && !remoteEntry) {
        localEntry.updateStatus(FileEntryStatus.removed);
        parent.addChild(localEntry);
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

        if (
          localEntry.size !== remoteEntry.size ||
          localEntry.modifiedTime.getTime() !==
            remoteEntry.modifiedTime.getTime()
        ) {
          currentEntry.updateStatus(FileEntryStatus.modified);
        }

        parent.addChild(currentEntry);

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
    console.log("\n");
    console.log("Recusive root: ", root);
    return root.children;
  }
}
