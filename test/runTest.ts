import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  const extDevPath = path.resolve(__dirname, "../../..");              // repo root
  const testsPath  = path.resolve(__dirname, "./suite/index");         // compiled test runner

  // Choose which workspace to open via env LS_WS = single | multi | broken
  const ws = (process.env.LS_WS ?? "single").toLowerCase();
  const wsMap: Record<string, string[]> = {
    single: [path.resolve(__dirname, "../../../test-fixtures/single")],
    multi:  [path.resolve(__dirname, "../../../test-fixtures/multi/livesync-multi.code-workspace")],
    broken: [path.resolve(__dirname, "../../../test-fixtures/broken")]
  };
  const launchArgs = wsMap[ws] ?? wsMap.single;

  await runTests({
    extensionDevelopmentPath: extDevPath,
    extensionTestsPath: testsPath,
    launchArgs
  });
}

main().catch(err => { console.error(err); process.exit(1); });
