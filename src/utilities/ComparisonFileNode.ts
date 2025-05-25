import { BaseNode, BaseNodeData, BaseNodeType } from "./BaseNode";
import { FileNode } from "./FileNode";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";
import { splitParts } from "./fileUtils/filePathUtils";
import { StatusBarManager } from "../managers/StatusBarManager";

export enum ComparisonStatus {
  added = "added",
  removed = "removed",
  modified = "modified",
  unchanged = "unchanged"
}

export interface ComparisonFileData extends BaseNodeData {
  status: ComparisonStatus;
}

export class ComparisonFileNode extends BaseNode<ComparisonFileNode> {
  status: ComparisonStatus;
  showInTree: boolean;

  constructor(
    nameOrJson: string | ComparisonFileData,
    type?: BaseNodeType,
    size?: number,
    modifiedTime?: Date,
    relativePath?: string,
    status: ComparisonStatus = ComparisonStatus.unchanged
  ) {
    if (typeof nameOrJson === "string") {
      // Regular constructor logic
      super(nameOrJson, type, size, modifiedTime, relativePath);
      this.status = status;
    } else {
      // Constructor from JSON
      const json = nameOrJson;
      super(json.name, json.type, json.size, new Date(json.modifiedTime), json.relativePath);
      this.status = json.status;

      if (json.children) {
        this.setChildren(new Map(Object.entries(json.children).map(([key, value]) => [key, this.fromJSON(value)])));
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
  static compareFileNodes(localNode?: FileNode, remoteNode?: FileNode): ComparisonFileNode {
    StatusBarManager.showMessage(`Comparing...`, "", "", 0, "sync~spin", true);

    // Determine the common properties for the ComparisonFileNode
    const name = localNode ? localNode.name : remoteNode!.name;
    const type = localNode ? localNode.type : remoteNode!.type;
    const size = localNode ? localNode.size : remoteNode!.size;
    const modifiedTime = localNode ? localNode.modifiedTime : remoteNode!.modifiedTime;
    const relativePath = localNode ? localNode.relativePath : remoteNode!.relativePath;

    let status: ComparisonStatus = ComparisonStatus.unchanged;

    // Determine the status of the ComparisonFileNode based on the presence and properties of the local and remote nodes
    if (!localNode && remoteNode) {
      status = ComparisonStatus.removed;
    } else if (localNode && !remoteNode) {
      status = ComparisonStatus.added;
    } else if (localNode && remoteNode) {
      if (localNode.type !== remoteNode.type) {
        status = ComparisonStatus.modified;
      } else if (localNode.type === BaseNodeType.file && remoteNode.type === BaseNodeType.file) {
        if (localNode.hash !== remoteNode.hash) {
          status = ComparisonStatus.modified;
        }
      }
    }

    // Create the ComparisonFileNode
    const comparisonNode = new ComparisonFileNode(name, type, size, modifiedTime, relativePath, status);

    // Recursively compare children and add them to the ComparisonFileNode
    const allChildrenNames = new Set([...(localNode?.children.keys() || []), ...(remoteNode?.children.keys() || [])]);

    for (const childName of allChildrenNames) {
      const localChild = localNode?.getChild(childName);
      const remoteChild = remoteNode?.getChild(childName);
      const childComparisonNode = this.compareFileNodes(localChild, remoteChild);
      comparisonNode.addChild(childComparisonNode);

      // If any child is different than unchanged, mark the current folder node as modified
      if (childComparisonNode.status !== ComparisonStatus.unchanged) {
        comparisonNode.status = ComparisonStatus.modified;
      }
    }

    return comparisonNode;
  }

  /**
   * Recursively sets the status of a ComparisonFileNode and all its children to the specified ComparisonStatus.
   * @param node - The root ComparisonFileNode to update.
   * @param status - The ComparisonStatus to set for the node and its children.
   */
  static setComparisonStatus(node: ComparisonFileNode, status: ComparisonStatus): void {
    // Set the status for the current node
    node.status = status;

    // Iterate through the children if the node has any
    if (node.listChildren().length > 0) {
      for (const child of node.listChildren()) {
        this.setComparisonStatus(child, status); // Recursively set status for children
      }
    }
  }

  fromJSON(json: any): ComparisonFileNode {
    return new ComparisonFileNode(json);
  }

  toJSON(): any {
    const baseJson = super.toJSON();
    return {
      ...baseJson,
      relativePath: this.relativePath,
      status: this.status
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
    element: ComparisonFileNode
  ): ComparisonFileNode {
    const rootName = WorkspaceConfigManager.getWorkspaceBasename();
    const rootNode = rootEntries.get(rootName);
    if (!rootNode || !rootNode.isDirectory()) {
      console.error(`Root "${rootName}" not found or not a directory.`);
      return element;
    }
  
    // Split into segments, e.g. ['src','utils','file.ts']
    const parts = splitParts(element.relativePath);
    // The path to the folder containing `element`
    const parentSegments = parts.slice(0, parts.length - 1);
  
    let topMostUpdated: ComparisonFileNode | null = null;
  
    // Walk from the deepest parent back up to the workspace root
    for (let depth = parentSegments.length; depth > 0; depth--) {
      // Build the relPath for this ancestor folder
      const thisPath = parentSegments.slice(0, depth).join('/');
      // Descend from rootNode to find it
      let node: ComparisonFileNode | undefined = rootNode;
      for (const seg of thisPath.split('/')) {
        if (!node.isDirectory()) {
          node = undefined;
          break;
        }
        node = node.children.get(seg);
        if (!node) break;
      }
      if (!node || !node.isDirectory()) {
        break;
      }
  
      // Recompute: if any direct child ≠ unchanged → modified; else unchanged
      const anyChanged = Array
        .from(node.children.values())
        .some(c => c.status !== ComparisonStatus.unchanged);
  
      const newStatus = anyChanged
        ? ComparisonStatus.modified
        : ComparisonStatus.unchanged;
  
      // If it’s already that status, nothing above will change either → stop
      if (node.status === newStatus) {
        break;
      }
  
      // Otherwise update it and remember it as the highest-level update so far
      node.status = newStatus;
      topMostUpdated = node;
    }
  
    // Return the topmost folder we actually changed, or the element if none
    return topMostUpdated ?? element;
  }
}
