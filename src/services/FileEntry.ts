import * as crypto from "crypto";

export class FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedTime: Date;
  source: "remote" | "local";
  status?: "modified" | "missing" | "unchanged";
  children: Map<string, FileEntry>;
  fullPath: string;

  hash: string;

  constructor(
    name: string,
    type: "file" | "directory",
    size: number,
    modifiedTime: Date,
    source: "remote" | "local",
    fullPath: string,
    status?: "modified" | "missing" | "unchanged",
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

  listChildren(): FileEntry[] {
    return Array.from(this.children.values());
  }

  updateStatus(newStatus: "modified" | "missing" | "unchanged"): void {
    this.status = newStatus;
  }

  generateHash(): string {
    const hash = crypto.createHash("sha256");
    hash.update(`${this.name}${this.size}${this.modifiedTime.toISOString()}`); // Using ISO string for consistent date formatting
    return hash.digest("hex");
  }

  static compareDirectories(localRoot: FileEntry, remoteRoot: FileEntry) {
    const changes: {
      added: FileEntry[];
      removed: FileEntry[];
      modified: FileEntry[];
    } = {
      added: [],
      removed: [],
      modified: [],
    };

    function recurse(
      localEntry: FileEntry | undefined,
      remoteEntry: FileEntry | undefined,
    ) {
      if (!localEntry && remoteEntry) {
        changes.added.push(remoteEntry);
        remoteEntry.children.forEach((child) => recurse(undefined, child));
        return;
      }
      if (localEntry && !remoteEntry) {
        changes.removed.push(localEntry);
        localEntry.children.forEach((child) => recurse(child, undefined));
        return;
      }
      if (localEntry && remoteEntry) {
        if (localEntry.hash !== remoteEntry.hash) {
          changes.modified.push(localEntry);
        }
        const allKeys = new Set([
          ...localEntry.children.keys(),
          ...remoteEntry.children.keys(),
        ]);
        allKeys.forEach((key) => {
          recurse(localEntry.children.get(key), remoteEntry.children.get(key));
        });
      }
    }

    recurse(localRoot, remoteRoot);

    return changes;
  }
}
