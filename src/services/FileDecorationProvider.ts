import * as vscode from "vscode";
import * as path from "path";

import { FileEntryStatus } from "../utilities/FileEntry";

export class FileStatusDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly decorationData = new Map<
    FileEntryStatus,
    vscode.FileDecoration
  >();

  constructor() {
    // Define decorations for each status using theme colors
    this.decorationData.set(FileEntryStatus.added, {
      badge: "A",
      tooltip: "Added",
      color: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      propagate: true,
    });
    this.decorationData.set(FileEntryStatus.removed, {
      badge: "R",
      tooltip: "Removed",
      color: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
      propagate: true,
    });
    this.decorationData.set(FileEntryStatus.modified, {
      badge: "M",
      tooltip: "Modified",
      color: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
      propagate: true,
    });
    this.decorationData.set(FileEntryStatus.unchanged, {
      badge: "U",
      tooltip: "Unchanged",
      color: new vscode.ThemeColor("gitDecoration.untrackedResourceForeground"),
      propagate: true,
    });
  }

  provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const params = new URLSearchParams(uri.query);
    const status = params.get("status");
    const fileEntryStatus: FileEntryStatus =
      FileEntryStatus[status as keyof typeof FileEntryStatus];

    return this.decorationData.get(
      fileEntryStatus || FileEntryStatus.unchanged,
    );
  }
}
