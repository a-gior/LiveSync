import * as path from "path";
import Mocha from "mocha";
import { Glob } from "glob";

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
    color: true
  });

  const testsRoot = path.resolve(__dirname, "..");

  return new Promise(async (c, e) => {
    const glob = new Glob("**/**.test.js", {
      cwd: testsRoot,
      withFileTypes: true
    });
    for (const file of glob) {
      mocha.addFile(file.fullpath());
    }

    try {
      // Run the mocha test
      mocha.run((failures) => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      console.error(err);
      e(err);
    }
  });
}
