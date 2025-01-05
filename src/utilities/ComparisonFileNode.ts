import path from "path";
import { logErrorMessage } from "../managers/LogManager";
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
  pairedFolderName: string;
}

export class ComparisonFileNode extends BaseNode<ComparisonFileNode> {
  status: ComparisonStatus;
  showInTree: boolean;

  constructor(
    nameOrJson: string | ComparisonFileData,
    pairedFolderName?: string,
    type?: BaseNodeType,
    size?: number,
    modifiedTime?: Date,
    relativePath?: string,
    status: ComparisonStatus = ComparisonStatus.unchanged,
  ) {
    if (typeof nameOrJson === "string") {
      // Regular constructor logic
      super(
        nameOrJson,
        pairedFolderName,
        type,
        size,
        modifiedTime,
        relativePath,
      );
      this.status = status;
    } else {
      // Constructor from JSON
      const json = nameOrJson;
      super(
        json.name,
        json.pairedFolderName,
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

    this.showInTree = true;
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
    const pairedFolderName = localNode
      ? localNode.pairedFolderName
      : remoteNode!.pairedFolderName;
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
      pairedFolderName,
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

    let previousChildStatus: ComparisonStatus | undefined = undefined;

    for (const childName of allChildrenNames) {
      const localChild = localNode?.getChild(childName);
      const remoteChild = remoteNode?.getChild(childName);
      const childComparisonNode = this.compareFileNodes(
        localChild,
        remoteChild,
      );
      comparisonNode.addChild(childComparisonNode);

      if (!previousChildStatus) {
        previousChildStatus = childComparisonNode.status;
      }

      // If any child is added, removed, or modified, mark the current node as modified
      if (childComparisonNode.status !== previousChildStatus) {
        comparisonNode.status = ComparisonStatus.modified;
      }
    }

    if (
      comparisonNode.status !== ComparisonStatus.modified &&
      previousChildStatus
    ) {
      comparisonNode.status = previousChildStatus;
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
      pairedFolderName: this.pairedFolderName,
    };
  }

  clone(): ComparisonFileNode {
    try {
      // Convert the node to a JSON object, then parse it to create a new instance
      const jsonString = JSON.stringify(this.toJSON());
      const jsonData = JSON.parse(jsonString);
      return new ComparisonFileNode(jsonData);
    } catch (error: any) {
      throw new Error(`Failed to clone ComparisonFileNode: ${error.message}`);
    }
  }

  setStatus(status: ComparisonStatus) {
    this.status = status;
  }

  /**
   * Updates the status of parent directories based on the status of their children.
   * If all children are `unchanged`, the parent directory is marked as `unchanged`.
   * @param rootEntries The root elements map (from TreeDataProvider).
   * @param relativePath The relative path of the modified node.
   */
  static updateParentDirectoriesStatus(
    rootEntries: Map<string, ComparisonFileNode>,
    element: ComparisonFileNode,
  ): ComparisonFileNode {
    const pairedFolderName = element.pairedFolderName;
    const relativePath = element.relativePath;
    let topMostUpdatedEntry: ComparisonFileNode | null = null;

    // Find the initial root folder in rootEntries based on the pairedFolderName
    let currentEntry = rootEntries.get(pairedFolderName);
    if (!currentEntry || !currentEntry.isDirectory()) {
      logErrorMessage(
        `Paired folder "${pairedFolderName}" not found in root entries.`,
      );
      return element;
    }

    const pathParts = relativePath.split(path.sep);
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      currentEntry = currentEntry.children.get(part);

      if (!currentEntry || !currentEntry.isDirectory()) {
        // If the current entry is not found or is not a directory, we stop
        return topMostUpdatedEntry ?? element;
      }

      let newStatus: ComparisonStatus | null = null;
      for (const child of currentEntry.children.values()) {
        if (newStatus === null) {
          newStatus = child.status;
        } else if (child.status !== newStatus) {
          newStatus = ComparisonStatus.modified;
          break; // Early exit if any child has a different status
        }
      }

      const isStatusDifferent = currentEntry.status !== newStatus;

      if (newStatus !== null) {
        currentEntry.status = newStatus;
      }

      if (!topMostUpdatedEntry && isStatusDifferent) {
        topMostUpdatedEntry = currentEntry; // Track the highest-level folder updated
      }
    }

    return topMostUpdatedEntry ?? element;
  }
}
