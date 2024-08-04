import { BaseNode, BaseNodeData, BaseNodeType } from "./BaseNode";
import { FileNode } from "./FileNode";

export enum ComparisonStatus {
  added = "added",
  removed = "removed",
  modified = "modified",
  unchanged = "unchanged",
}

export interface ComparisonFileData extends BaseNodeData {
  status: ComparisonStatus;
}

export class ComparisonFileNode extends BaseNode<ComparisonFileNode> {
  status: ComparisonStatus;

  constructor(
    nameOrJson: string | ComparisonFileData,
    type?: BaseNodeType,
    size?: number,
    modifiedTime?: Date,
    relativePath?: string,
    status: ComparisonStatus = ComparisonStatus.unchanged,
  ) {
    if (typeof nameOrJson === "string") {
      // Regular constructor logic
      super(nameOrJson, type, size, modifiedTime, relativePath);
      this.status = status;
    } else {
      // Constructor from JSON
      const json = nameOrJson;
      super(
        json.name,
        json.type,
        json.size,
        new Date(json.modifiedTime),
        json.relativePath,
      );
      this.status = json.status;
      if (json.children) {
        this.setChildren(
          new Map(
            Object.entries(json.children).map(([key, value]) => [
              key,
              this.fromJSON(value),
            ]),
          ),
        );
      }
    }
  }

  /**
   * Recursively compares two FileNode objects and creates a ComparisonFileNode
   * reflecting the differences. It also compares all children recursively.
   *
   * @param localNode - The FileNode object representing the local file structure.
   * @param remoteNode - The FileNode object representing the remote file structure.
   * @returns ComparisonFileNode object representing the comparison result.
   */
  static compareFileNodes(
    localNode?: FileNode,
    remoteNode?: FileNode,
  ): ComparisonFileNode {
    // Determine the common properties for the ComparisonFileNode
    const name = localNode ? localNode.name : remoteNode!.name;
    const type = localNode ? localNode.type : remoteNode!.type;
    const size = localNode ? localNode.size : remoteNode!.size;
    const modifiedTime = localNode
      ? localNode.modifiedTime
      : remoteNode!.modifiedTime;
    const relativePath = localNode
      ? localNode.relativePath
      : remoteNode!.relativePath;

    let status: ComparisonStatus = ComparisonStatus.unchanged;

    // Determine the status of the ComparisonFileNode based on the presence and properties of the local and remote nodes
    if (!localNode && remoteNode) {
      status = ComparisonStatus.removed;
    } else if (localNode && !remoteNode) {
      status = ComparisonStatus.added;
    } else if (localNode && remoteNode) {
      if (localNode.type !== remoteNode.type) {
        status = ComparisonStatus.modified;
      } else if (
        localNode.type === BaseNodeType.file &&
        remoteNode.type === BaseNodeType.file
      ) {
        if (localNode.hash !== remoteNode.hash) {
          status = ComparisonStatus.modified;
        }
      }
    }

    // Create the ComparisonFileNode
    const comparisonNode = new ComparisonFileNode(
      name,
      type,
      size,
      modifiedTime,
      relativePath,
      status,
    );

    // Recursively compare children and add them to the ComparisonFileNode
    const allChildrenNames = new Set([
      ...(localNode?.children.keys() || []),
      ...(remoteNode?.children.keys() || []),
    ]);

    for (const childName of allChildrenNames) {
      const localChild = localNode?.getChild(childName);
      const remoteChild = remoteNode?.getChild(childName);
      const childComparisonNode = this.compareFileNodes(
        localChild,
        remoteChild,
      );
      comparisonNode.addChild(childComparisonNode);

      // If any child is added, removed, or modified, mark the current node as modified
      if (childComparisonNode.status !== ComparisonStatus.unchanged) {
        comparisonNode.status = ComparisonStatus.modified;
      }
    }

    return comparisonNode;
  }

  fromJSON(json: any): ComparisonFileNode {
    return new ComparisonFileNode(json);
  }

  toJSON(): any {
    const baseJson = super.toJSON();
    return {
      ...baseJson,
      relativePath: this.relativePath,
      status: this.status,
    };
  }

  setStatus(status: ComparisonStatus) {
    this.status = status;
  }
}
