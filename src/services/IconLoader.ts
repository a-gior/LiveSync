import * as vscode from "vscode";
import * as path from "path";

export class IconLoader {
  /**
   * Retrieves the ThemeIcon for a file based on its full name.
   * @param fileName - The full name of the file (e.g., "app.js").
   * @returns A VS Code ThemeIcon for the file.
   */
  public static getFileIcon(fileName: string): vscode.ThemeIcon {
    const fileExtension = path.extname(fileName); // Extract file extension
    return this.getThemeIcon({ fileExtension });
  }

  /**
   * Retrieves the ThemeIcon for a folder based on its full name.
   * @param folderName - The full name of the folder (e.g., "src").
   * @returns A VS Code ThemeIcon for the folder.
   */
  public static getFolderIcon(folderName: string): vscode.ThemeIcon {
    return this.getThemeIcon({ folderName });
  }

  /**
   * A generic function to get the ThemeIcon for a file, folder, or default fallback.
   * @param params - Object containing fileExtension or folderName.
   * @returns A VS Code ThemeIcon for the file or folder.
   */
  private static getThemeIcon(params: { fileExtension?: string; folderName?: string }): vscode.ThemeIcon {
    const { folderName } = params;

    // VS Code will automatically use the correct icon based on the file/folder name
    return folderName
      ? new vscode.ThemeIcon("folder") // Folders default to the "folder" icon
      : new vscode.ThemeIcon("file"); // Files default to the "file" icon
  }
}
