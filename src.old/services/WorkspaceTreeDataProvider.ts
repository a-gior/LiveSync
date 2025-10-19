import {
  TreeDataProvider,
  TreeItem,
  EventEmitter,
  workspace,
  WorkspaceFolder,
  TreeItemCollapsibleState
} from 'vscode';

export class WorkspaceTreeDataProvider
  implements TreeDataProvider<WorkspaceFolder> {
  private _onDidChange = new EventEmitter<WorkspaceFolder | void>();
  public readonly onDidChangeTreeData = this._onDidChange.event;

  /** Call to refresh the view */
  public refresh() {
    this._onDidChange.fire();
  }

  /**
   * Convert a WorkspaceFolder into a TreeItem.
   */
  public getTreeItem(element: WorkspaceFolder): TreeItem {
    const item = new TreeItem(
      element.name,
      TreeItemCollapsibleState.None
    );
    item.resourceUri = element.uri;
    return item;
  }

  /**
   * Return top-level workspace folders.
   * Since workspace.workspaceFolders is readonly, we copy it into a mutable array.
   */
  public getChildren(element?: WorkspaceFolder): WorkspaceFolder[] {
    if (element) {
      // no nested children
      return [];
    }
    const folders = workspace.workspaceFolders;
    return folders ? [...folders] : [];
  }
}
