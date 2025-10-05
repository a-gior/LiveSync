// src/test/suite/index.ts
import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 20000 });
  const testsRoot = path.resolve(__dirname);

  // glob v10 returns a Promise<string[]>
  const files = await glob("**/*.test.js", { cwd: testsRoot });

  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }

  // Wrap Mocha's runner in a Promise
  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run(failures =>
        failures ? reject(new Error(`${failures} tests failed.`)) : resolve()
      );
    } catch (e) {
      reject(e as Error);
    }
  });
}
