import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
} from "vscode";
import { getUri } from "../utilities/getUri";
import { getNonce } from "../utilities/getNonce";
import { Panel } from "./Panel";

/**
 * This class manages the state and behavior of HelloWorld webview panels.
 *
 * It contains all the data and methods for:
 *
 * - Creating and rendering HelloWorld webview panels
 * - Properly cleaning up and disposing of webview resources when the panel is closed
 * - Setting the HTML (and by proxy CSS/JavaScript) content of the webview panel
 * - Setting message listeners so data can be passed between the webview and extension
 */
export class HelloWorldPanel extends Panel {
  /**
   * The HelloWorldPanel class private constructor (called only from the render method).
   *
   * @param panel A reference to the webview panel
   * @param extensionUri The URI of the directory containing the extension
   */
  protected constructor(panel: WebviewPanel, extensionUri: Uri) {
    const fnCallback = (message: any) => {
      const command = message.command;
      const text = message.text;

      switch (command) {
        case "hello":
          // Code that should run in response to the hello message command
          window.showInformationMessage(text);
          return;
        // Add more switch case statements here as more webview message commands
        // are created within the webview context (i.e. inside media/main.js)
      }
    };

    super(
      panel,
      extensionUri,
      [
        "webview-ui/public/build/bundle.css",
        "webview-ui/public/build/bundle.js",
      ],
      fnCallback,
    );
  }

  /**
   * Renders the current webview panel if it exists otherwise a new webview panel
   * will be created and displayed.
   *
   * @param extensionUri The URI of the directory containing the extension.
   */
  public static render(extensionUri: Uri) {
    if (HelloWorldPanel.currentPanel) {
      // If the webview panel already exists reveal it
      HelloWorldPanel.currentPanel.getPanel().reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        // Panel view type
        "showHelloWorld",
        // Panel title
        "Hello World",
        // The editor column the panel should be displayed in
        ViewColumn.One,
        // Extra panel configurations
        {
          // Enable JavaScript in the webview
          enableScripts: true,
          // Restrict the webview to only load resources from the `out` and `webview-ui/public/build` directories
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/public/build"),
          ],
        },
      );

      HelloWorldPanel.currentPanel = new HelloWorldPanel(panel, extensionUri);
    }
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  public dispose() {
    HelloWorldPanel.currentPanel = undefined;

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
}
