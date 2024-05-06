import { window, Uri } from "vscode";
import { Panel } from "./Panel";

export class HelloWorldPanel extends Panel {
  public static render(extensionUri: Uri) {
    const localResourceRoots = [
      Uri.joinPath(extensionUri, "out"),
      Uri.joinPath(extensionUri, "webview-ui/public/build"),
    ];

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

    const filepaths = [
      "webview-ui/public/build/pages/main/main.css",
      "webview-ui/public/build/pages/main/main.js",
    ];

    // Call the render method from the parent class with additional parameters
    super.render(
      extensionUri,
      "showHelloWorld",
      "Hello World",
      localResourceRoots,
      filepaths,
      fnCallback,
      // Additional options if needed
    );
  }
}
