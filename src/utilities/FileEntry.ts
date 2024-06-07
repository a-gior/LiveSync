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

  setChildren(children: Map<string, FileEntry>) {
    this.children = children;
  }

  listChildren(): FileEntry[] {
    return Array.from(this.children.values());
  }

  isDirectory(): boolean {
    return this.type === FileEntryType.directory;
  }

  /**
   * Compares the directories of local and remote file entries and returns the differences.
   * @param localRoot The local root file entry.
   * @param remoteRoot The remote root file entry.
   * @returns A map of file entries with their comparison status.
   */
  static async compareDirectories(
    localRoot: FileEntry,
    remoteRoot: FileEntry,
  ): Promise<Map<string, FileEntry>> {
    /**
     * Recursively compares the local and remote file entries.
     * @param localEntry The local file entry.
     * @param remoteEntry The remote file entry.
     * @param parent The parent file entry to which the current entry belongs.
     */
    async function recurse(
      localEntry: FileEntry | undefined,
      remoteEntry: FileEntry | undefined,
      parent: FileEntry,
    ) {
      if (!localEntry && remoteEntry) {
        // Case: File/Folder is present in remote but not in local
        remoteEntry.updateStatus(FileEntryStatus.removed);
        parent.addChild(remoteEntry);
        // parent.updateStatus(FileEntryStatus.modified); // Mark parent as modified
        for (const child of remoteEntry.children.values()) {
          await recurse(undefined, child, remoteEntry);
        }

        FileEntry.updateDirectoryStatusBasedOnChildren(remoteEntry);
        return;
      }

      if (localEntry && !remoteEntry) {
        // Case: File/Folder is present in local but not in remote
        localEntry.updateStatus(FileEntryStatus.added);
        parent.addChild(localEntry);
        // parent.updateStatus(FileEntryStatus.modified); // Mark parent as modified
        for (const child of localEntry.children.values()) {
          await recurse(child, undefined, localEntry);
        }

        FileEntry.updateDirectoryStatusBasedOnChildren(localEntry);
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
          localEntry.type === FileEntryType.file &&
          remoteEntry.type === FileEntryType.file
        ) {
          // Compute hashes in parallel for files
          const [localHash, remoteHash] = await Promise.all([
            generateHash(
              localEntry.fullPath,
              localEntry.source,
              localEntry.type,
            ),
            generateHash(
              remoteEntry.fullPath,
              remoteEntry.source,
              remoteEntry.type,
            ),
          ]);

          if (localHash !== remoteHash) {
            currentEntry.updateStatus(FileEntryStatus.modified);
            parent.updateStatus(FileEntryStatus.modified);
          } else {
            currentEntry.updateStatus(FileEntryStatus.unchanged);
          }
        } else {
          // Directories are marked as unchanged initially, will update based on children
          currentEntry.updateStatus(FileEntryStatus.unchanged);
        }

        const showUnchanged = workspace
          .getConfiguration("LiveSync")
          .get<boolean>("showUnchanged", true);

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

        for (const key of allKeys) {
          await recurse(
            localEntry.children.get(key),
            remoteEntry.children.get(key),
            currentEntry,
          );
        }

        FileEntry.updateDirectoryStatusBasedOnChildren(currentEntry);
        return;
      }
    }

    const root = new FileEntry(
      localRoot.name,
      FileEntryType.directory,
      localRoot.size,
      localRoot.modifiedTime,
      localRoot.source,
      localRoot.fullPath,
    );
    // Start recursion from the root entries
    await recurse(localRoot, remoteRoot, root);
    return root.children;
  }

  /**
   * Updates the status of a directory based on the statuses of its children.
   * @param currentEntry The current directory entry whose status needs to be updated.
   */
  private static updateDirectoryStatusBasedOnChildren(currentEntry: FileEntry) {
    let previousStatus: FileEntryStatus | undefined;

    // Iterate over the children and track their statuses
    for (const child of currentEntry.children.values()) {
      if (!child.status) {
        console.error(
          `[updateDirectoryStatusBasedOnChildren] CurrentEntry (${currentEntry.name}) child ${child.name} parameter has no status`,
        );
        return;
      }

      if (
        child.status === FileEntryStatus.modified ||
        (previousStatus && previousStatus !== child.status)
      ) {
        currentEntry.updateStatus(FileEntryStatus.modified);
        console.log(
          `DEBUG: childrenStats TESTING ${currentEntry.name}`,
          FileEntryStatus.modified,
        );
        return; // Early exit on first modified status
      }
      previousStatus = child.status;
    }

    return previousStatus;
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
