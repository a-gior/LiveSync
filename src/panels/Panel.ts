import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  WebviewOptions,
} from "vscode";
import { getUri } from "../utilities/getUri";
import { getNonce } from "../utilities/getNonce";
import * as path from "path";
import * as fs from "fs";
import { ConfigurationMessage } from "../ui/DTOs/messages/configurationDTO";

type WebviewMessageCallback = (message: any) => void;

export class Panel {
  protected _disposables: Disposable[] = [];
  public static currentPanel: Panel | undefined;
  protected readonly _panel: WebviewPanel;

  protected constructor(
    panel: WebviewPanel,
    extensionUri: Uri,
    filepaths: string[],
    callback: WebviewMessageCallback,
  ) {
    this._panel = panel;

    // Set an event listener to listen for when the panel is disposed (i.e. when the user closes
    // the panel or when the panel is closed programmatically)
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Set the HTML content for the webview panel
    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      extensionUri,
      filepaths,
    );

    // Set an event listener to listen for messages passed from the webview context
    this._setWebviewMessageListener(this._panel.webview, callback);
  }

  /**
   * Defines and returns the HTML that should be rendered within the webview panel.
   *
   * @remarks This is also the place where references to the Svelte webview build files
   * are created and inserted into the webview HTML.
   *
   * @param webview A reference to the extension webview
   * @param extensionUri The URI of the directory containing the extension
   * @returns A template string literal containing the HTML that should be
   * rendered within the webview panel
   */
  private _getWebviewContent(
    webview: Webview,
    extensionUri: Uri,
    filepaths: string[],
  ) {
    const nonce = getNonce();
    const title = "Panel test";

    // Generate the HTML content dynamically
    let htmlContent = /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
            <title>${title}</title>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    `;

    // Loop through each filepath in the array
    filepaths.forEach((filepath) => {
      const uri = getUri(webview, extensionUri, filepath.split("/"));
      const extension = path.extname(filepath).toLowerCase();

      // Add the CSS file
      if (extension === ".css") {
        htmlContent += /*html*/ `\n<link rel="stylesheet" type="text/css" href="${uri}">`;
      }

      // Add the JavaScript file
      if (extension === ".js") {
        htmlContent += /*html*/ `\n<script defer nonce="${nonce}" src="${uri}"></script>`;
      }
    });

    // Close the head tag and open the body tag
    htmlContent += /*html*/ `\n</head>\n<body>\n</body>\n</html>`;

    return htmlContent;
  }

  /**
   * Sets up an event listener to listen for messages passed from the webview context and
   * executes code based on the message that is recieved.
   *
   * @param webview A reference to the extension webview
   * @param context A reference to the extension context
   */
  private _setWebviewMessageListener(
    webview: Webview,
    callback: WebviewMessageCallback,
  ) {
    webview.onDidReceiveMessage(callback, undefined, this._disposables);
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    Panel.currentPanel = undefined;

    // Dispose of the current webview panel
    this._panel.dispose();

    // Dispose of all disposables (i.e. commands) for the current webview panel
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  public getPanel() {
    return this._panel;
  }
}
