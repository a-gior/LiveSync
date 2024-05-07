import * as path from "path";

import { runTests } from "@vscode/test-electron";
import { file, dir } from "tmp-promise";

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../../");

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    const testWorkspace = path.resolve(
      __dirname,
      "../../out/src/test/workspace-test",
    );

    const { path: tempdir, cleanup } = await dir({ unsafeCleanup: true });
    console.log("Creating temp folder as workspace : ", tempdir);

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath: extensionTestsPath,
      launchArgs: [tempdir],
    });

    cleanup();
  } catch (err) {
    console.error("Failed to run tests");
    process.exit(1);
  }
}

main();
