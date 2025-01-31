export enum BaseNodeType {
  file = "file",
  directory = "directory"
}

export interface BaseNodeData {
  name: string;
  type: BaseNodeType;
  size: number;
  modifiedTime: Date | string;
  relativePath: string;
  children?: { [key: string]: any } | Map<string, BaseNode<any>>;
}

export abstract class BaseNode<T extends BaseNode<any>> {
  name: string;
  type: BaseNodeType;
  size: number;
  modifiedTime: Date;
  relativePath: string;
  children: Map<string, T>;

  constructor(data: BaseNodeData | string, type?: BaseNodeType, size?: number, modifiedTime?: Date, relativePath?: string) {
    if (typeof data === "string") {
      // Traditional constructor parameters
      this.name = data;
      this.type = type!;
      this.size = size!;
      this.modifiedTime = modifiedTime!;
      this.relativePath = relativePath!;
      this.children = new Map<string, T>();
    } else {
      // JSON-like object initialization
      this.name = data.name;
      this.type = data.type;
      this.size = data.size;
      this.modifiedTime = new Date(data.modifiedTime);
      this.relativePath = data.relativePath;
      this.children = new Map<string, T>();

      if (data.children) {
        this.setChildren(data.children);
      }
    }
  }

  setChildren(children: Map<string, T> | { [key: string]: any }): void {
    if (children instanceof Map) {
      this.children = children;
    } else {
      this.children = new Map(Object.entries(children).map(([key, value]) => [key, this.fromJSON(value)]));
    }
  }

  abstract fromJSON(json: any): T;

  toJSON(): any {
    return {
      name: this.name,
      type: this.type,
      size: this.size,
      modifiedTime: this.modifiedTime.toISOString(),
      relativePath: this.relativePath,
      children: Object.fromEntries(Array.from(this.children.entries()).map(([key, value]) => [key, value.toJSON()]))
    };
  }

  addChild(child: T): void {
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
  static toArray<T extends BaseNode<any>>(map: Map<string, T>): T[] {
    return Array.from(map.values());
  }
}
