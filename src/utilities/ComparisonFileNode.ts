import { BaseNode, BaseNodeData, BaseNodeType } from "./BaseNode";
import { FileNode } from "./FileNode";
import { WorkspaceConfigManager } from "../managers/WorkspaceConfigManager";
import { splitParts } from "./fileUtils/filePathUtils";
import JsonManager from "../managers/JsonManager";
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

  static compareFileNodes(
    localNode?: FileNode,
    remoteNode?: FileNode,
    existingCompNode?: ComparisonFileNode,
    isRoot: boolean = true
  ): ComparisonFileNode {
    // 1) Show spinner only once
    if (isRoot) {
      StatusBarManager.showMessage(
        `Building comparison tree…`, "", "", 0, "sync~spin", true
      );
    }

    // 2) Gather some booleans & base props
    const hasLocal = !!localNode;
    const hasRemote = !!remoteNode;
    const base = localNode ?? remoteNode!;  // whichever exists
    const { name, type, size, modifiedTime, relativePath, hash } = base;
    const isDir = type === BaseNodeType.directory;

    // 3) Decide status in one place
    let status = ComparisonStatus.unchanged;
    if (!hasLocal)                     status = ComparisonStatus.removed;
    else if (!hasRemote)               status = ComparisonStatus.added;
    else if (localNode!.type !== remoteNode!.type) {
      status = ComparisonStatus.modified;
    } else if (!isDir) {  // file vs file
      if (localNode!.hash !== remoteNode!.hash) {
        status = ComparisonStatus.modified;
      }
    } else {              // directory vs directory
      if (localNode!.hash !== remoteNode!.hash) {
        status = ComparisonStatus.modified;
      }
    }

    // 4) FAST-PATH: if unchanged *and* we have an existing node with the same hash
    if (
      status === ComparisonStatus.unchanged &&
      existingCompNode?.status === ComparisonStatus.unchanged &&
      existingCompNode.hash === hash
    ) {
      return existingCompNode;
    }

    // 5) Build fresh node, and record its hash if unchanged
    const compNode = new ComparisonFileNode(name, type, size, modifiedTime, relativePath, status);
    if (status === ComparisonStatus.unchanged) {
      compNode.hash = hash;
    }

    // 6) Only recurse into children for directories
    if (isDir) {
      const childNames = new Set<string>([
        ...localNode?.children.keys()  || [],
        ...remoteNode?.children.keys() || []
      ]);

      for (const childName of childNames) {
        const lChild = localNode?.getChild(childName);
        const rChild = remoteNode?.getChild(childName);
        const existingChild = existingCompNode?.getChild(childName);

        // pass isRoot=false so subcalls don’t re-show the spinner
        const childComp = this.compareFileNodes(
          lChild,
          rChild,
          existingChild,
          false
        );
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
