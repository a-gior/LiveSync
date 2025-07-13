import { Uri, WorkspaceFolder } from "vscode";

type ChildrenNodeMap<T> = Map<string, T>;

export enum BaseNodeType {
  file = "file",
  directory = "directory"
}

export interface BaseNodeData {
  workspaceFolder: WorkspaceFolder;
  name: string;
  type: BaseNodeType;
  size: number;
  modifiedTime: Date | string;
  relativePath: string;
  children?: Map<string, BaseNode<any>>;
  hash: string;
}

export abstract class BaseNode<T extends BaseNode<any>> {
  workspaceFolder: WorkspaceFolder;
  name: string;
  type: BaseNodeType;
  size: number;
  modifiedTime: Date;
  relativePath: string;
  children: ChildrenNodeMap<T>;
  hash: string;
  parent?: T;

  constructor(data: BaseNodeData | string, workspaceFolder?: WorkspaceFolder, type?: BaseNodeType, size?: number, modifiedTime?: Date, relativePath?: string, hash?: string) {
    if (typeof data === "string") {
      // Traditional constructor parameters
      this.name = data;
      this.workspaceFolder = workspaceFolder!;
      this.type = type!;
      this.size = size!;
      this.modifiedTime = modifiedTime!;
      this.relativePath = relativePath!;
      this.hash = hash || "";
      this.children = new Map<string, T>();
    } else {
      // JSON-like object initialization
      this.name = data.name;
      this.workspaceFolder = data.workspaceFolder;
      this.type = data.type;
      this.size = data.size;
      this.modifiedTime = new Date(data.modifiedTime);
      this.relativePath = data.relativePath;
      this.hash = data.hash;
      this.children = new Map<string, T>();

      if (data.children) {
        this.setChildren(data.children);
      }
    }
  }

  setChildren(raw: Map<string, T> | { [key: string]: any }): void {
    let map: Map<string, T>;
    if (raw instanceof Map) {
      map = raw;
    } else {
      map = new Map(Object.entries(raw).map(([key, json]) => {
        const node = this.fromJSON(json);
        node.parent = this as unknown as T;
        return [key, node];
      }));
    }
    this.children = map;
  }

  abstract fromJSON(json: any): T;

  toJSON(): any {
    return {
      name: this.name,
      workspaceFolder: this.workspaceFolder,
      type: this.type,
      size: this.size,
      modifiedTime: this.modifiedTime.toISOString(),
      relativePath: this.relativePath,
      hash: this.hash,
      children: Object.fromEntries(Array.from(this.children.entries()).map(([key, value]) => [key, value.toJSON()]))
    };
  }

  addChild(child: T): void {
    child.parent = child.parent ?? (this as unknown as T);
    this.children.set(child.name, child);
  }

  getChild(name: string): T | undefined {
    return this.children.get(name);
  }

  removeChild(name: string): boolean {
    return this.children.delete(name);
  }

  listChildren(): T[] {
    return Array.from(this.children.values());
  }

  isDirectory(): boolean {
    return this.type === BaseNodeType.directory;
  }

  // Static method to convert a Map to an array
  static toArray<T extends BaseNode<any>>(map: ChildrenNodeMap<T>): T[] {
    return Array.from(map.values());
  }
}
