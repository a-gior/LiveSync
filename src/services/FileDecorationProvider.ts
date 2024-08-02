import * as vscode from "vscode";
import * as path from "path";

import { FileNodeStatus } from "../utilities/FileNode";

export class FileStatusDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly decorationData = new Map<
    FileNodeStatus,
    vscode.FileDecoration
  >();

  constructor() {
    // Define decorations for each status using theme colors
    this.decorationData.set(FileNodeStatus.added, {
      badge: "A",
      tooltip: "Added",
      color: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      propagate: false,
    });
    this.decorationData.set(FileNodeStatus.removed, {
      badge: "R",
      tooltip: "Removed",
      color: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
      propagate: false,
    });
    this.decorationData.set(FileNodeStatus.modified, {
      badge: "M",
      tooltip: "Modified",
      color: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
      propagate: false,
    });
    this.decorationData.set(FileNodeStatus.unchanged, {
      badge: "U",
      tooltip: "Unchanged",
      color: new vscode.ThemeColor("foreground"),
      propagate: false,
    });
  }

  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const params = new URLSearchParams(uri.query);
    const status = params.get("status");
    const fileEntryStatus: FileNodeStatus =
      FileNodeStatus[status as keyof typeof FileNodeStatus];

    return this.decorationData.get(fileEntryStatus || FileNodeStatus.unchanged);
  }
}
