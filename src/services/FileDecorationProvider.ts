import { ComparisonStatus } from "../utilities/ComparisonFileNode";
import * as vscode from "vscode";

export class FileStatusDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly decorationData = new Map<
    ComparisonStatus,
    vscode.FileDecoration
  >();

  constructor() {
    // Define decorations for each status using theme colors
    this.decorationData.set(ComparisonStatus.added, {
      badge: "A",
      tooltip: "Added",
      color: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      propagate: false,
    });
    this.decorationData.set(ComparisonStatus.removed, {
      badge: "R",
      tooltip: "Removed",
      color: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
      propagate: false,
    });
    this.decorationData.set(ComparisonStatus.modified, {
      badge: "M",
      tooltip: "Modified",
      color: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
      propagate: false,
    });
    this.decorationData.set(ComparisonStatus.unchanged, {
      badge: "U",
      tooltip: "Unchanged",
      color: new vscode.ThemeColor("foreground"),
      propagate: false,
    });
  }

  provideFileDecoration(
    uri: vscode.Uri,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const params = new URLSearchParams(uri.query);
    const status = params.get("status");
    const fileEntryStatus: ComparisonStatus =
      ComparisonStatus[status as keyof typeof ComparisonStatus];

    return this.decorationData.get(fileEntryStatus || ComparisonStatus.unchanged);
  }
}
