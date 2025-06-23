import { BaseNode, BaseNodeData, BaseNodeType } from "./BaseNode";
import { FileNode } from "./FileNode";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";
import { splitParts } from "./fileUtils/filePathUtils";
import { StatusBarManager } from "../managers/StatusBarManager";
import JsonManager from "../managers/JsonManager";

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

  static compareFileNodes(
    localNode?: FileNode,
    remoteNode?: FileNode
  ): ComparisonFileNode {
    StatusBarManager.showMessage(`Comparing…`, "", "", 0, "sync~spin", true);
  
    // Determine base properties
    const name = localNode ? localNode.name : remoteNode!.name;
    const type = (localNode ?? remoteNode)!.type;
    const size = (localNode ?? remoteNode)!.size;
    const modifiedTime = (localNode ?? remoteNode)!.modifiedTime;
    const relativePath = (localNode ?? remoteNode)!.relativePath;
  
    let status = ComparisonStatus.unchanged;
  
    if(name === "testfolder2") {
      console.log("Comparing testfolder2");
    }

    // 1) New or deleted
    if (!localNode && remoteNode) {
      status = ComparisonStatus.removed;
    } else if (localNode && !remoteNode) {
      status = ComparisonStatus.added;
    }
    // 2) Both exist
    else if (localNode && remoteNode) {
      // Type changed?
      if (localNode.type !== remoteNode.type) {
        status = ComparisonStatus.modified;
      }
      // File vs. file: compare hashes
      else if (type === BaseNodeType.file) {
        if (localNode.hash !== remoteNode.hash) {
          status = ComparisonStatus.modified;
        }
      }
      // Directory vs. directory: if hashes match, nothing changed—early exit
      else if (type === BaseNodeType.directory) {
        if (localNode.hash === remoteNode.hash) {
          // no children have changed
          return new ComparisonFileNode(
            name, type, size, modifiedTime, relativePath, ComparisonStatus.unchanged
          );
        }
        // otherwise, we’ll recurse into children
        status = ComparisonStatus.modified;
      }
    }
  
    // Build the comparison node
    const compNode = new ComparisonFileNode(
      name, type, size, modifiedTime, relativePath, status
    );
  
    // 3) If it’s a directory that may have changes, recurse children
    if (type === BaseNodeType.directory) {
      const names = new Set<string>([
        ...(localNode?.children.keys() || []),
        ...(remoteNode?.children.keys() || [])
      ]);
  
      for (const childName of names) {
        const l = localNode?.getChild(childName);
        const r = remoteNode?.getChild(childName);
        const childComp = this.compareFileNodes(l, r);
        compNode.addChild(childComp);
      }
    }
  
    return compNode;
  }

  /**
   * Recursively sets the status of a ComparisonFileNode and all its children to the specified ComparisonStatus.
   * @param node - The root ComparisonFileNode to update.
   * @param status - The ComparisonStatus to set for the node and its children.
   */
  setStatus(status: ComparisonStatus): void {
    // Set the status for the current node
    this.status = status;

    // Iterate through the children if the node has any
    if (this.listChildren().length > 0) {
      for (const child of this.listChildren()) {
        child.setStatus(status); // Recursively set status for children
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

  /**
   * Updates the status of parent directories based on the status of their children.
   * If all children are `unchanged`, the parent directory is marked as `unchanged`.
   * @param rootEntries The root elements map (from TreeDataProvider).
   * @param relativePath The relative path of the modified node.
   */
  static async updateParentDirectoriesStatus(
    rootEntries: Map<string, ComparisonFileNode>,
    element: ComparisonFileNode
  ): Promise<ComparisonFileNode> {
    const rootName = WorkspaceConfigManager.getWorkspaceBasename();
    const rootNode = rootEntries.get(rootName);
    if (!rootNode || !rootNode.isDirectory()) {
      console.error(`Root "${rootName}" not found or not a directory.`);
      return element;
    }
  
    const parts = splitParts(element.relativePath);
    const parents = parts.slice(0, -1);
  
    // Fast-path bail for pure add/remove
    if (parents.length > 0) {
      const firstParentRel = parents.join("/");
      const firstParent = await JsonManager.findNodeByPath(firstParentRel, rootEntries, rootName);
      if (
        (element.status === ComparisonStatus.added   && firstParent?.status === ComparisonStatus.added) ||
        (element.status === ComparisonStatus.removed && firstParent?.status === ComparisonStatus.removed)
      ) {
        return element;
      }
    }
  
    let topMostUpdated: ComparisonFileNode | null = null;
  
    // Walk up
    for (let depth = parents.length; depth > 0; depth--) {
      const relPath = parents.slice(0, depth).join("/");
      const folder = await JsonManager.findNodeByPath(relPath, rootEntries, rootName);
      if (!folder || !folder.isDirectory()) {break;}
  
      // If any child changed, mark modified
      const anyChanged = Array.from(folder.children.values())
        .some(c => c.status !== ComparisonStatus.unchanged);
  
      if (!anyChanged && folder.status !== ComparisonStatus.unchanged) {
        folder.status = ComparisonStatus.unchanged;
        topMostUpdated = folder;
      } else if(!anyChanged) {
        break;
      } else if (folder.status !== ComparisonStatus.modified) {
        folder.status = ComparisonStatus.modified;
        topMostUpdated = folder;
      } else {
        break;
      }
    }
  
    return topMostUpdated ?? element;
  }
}
