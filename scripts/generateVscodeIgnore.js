const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const vscodeIgnorePath = ".vscodeignore";
const webviewPath = path.join(process.cwd(), "webview-ui");
const startMarker = "#### Include only production dependencies ####";
const endMarker = "##############################################";

function checkNodeModules(dir, label) {
  const nm = path.join(dir, "node_modules");
  if (!fs.existsSync(nm)) {
    console.error(
      `❌ ${label} node_modules not found at ${nm}.\n` +
      `   Run 'npm install' in ${dir} before generating .vscodeignore.`
    );
    process.exit(1);
  }
}

function getProdDependencies(dir) {
  try {
    return execSync("npm list --omit=dev --parseable --depth=9999", { cwd: dir })
      .toString()
      .trim()
      .split("\n")
      .map((line) => {
        const relativePath = path.relative(process.cwd(), line).replace(/\\/g, "/");
        console.log(`📦 ${relativePath}`);
        return `!${relativePath}`;
      })
      .filter(Boolean);
  } catch (error) {
    console.warn(`⚠️ Warning: Failed to fetch dependencies from ${dir}: ${error.message}`);
    return [];
  }
}

try {
  checkNodeModules(process.cwd(), "Main extension");
  checkNodeModules(webviewPath, "Webview UI");

  let mainDeps = getProdDependencies(process.cwd());
  let webviewDeps = getProdDependencies(webviewPath);

  // Remove first entry (root project path) from both
  mainDeps.shift();
  webviewDeps.shift();

  let vscodeIgnore = fs.readFileSync(vscodeIgnorePath, "utf8").replace(/\r\n/g, "\n").split("\n");

  const startIndex = vscodeIgnore.indexOf(startMarker);
  const endIndex = vscodeIgnore.indexOf(endMarker, startIndex + 1);

  if (startIndex === -1 || endIndex === -1) {
    console.error("❌ Error: Could not find dependency markers in .vscodeignore");
    process.exit(1);
  }

  vscodeIgnore = [
    ...vscodeIgnore.slice(0, startIndex + 1),
    "# 📌 Main Extension Dependencies",
    ...mainDeps,
    "# 📌 Webview UI Dependencies",
    ...webviewDeps,
    ...vscodeIgnore.slice(endIndex),
  ];

  fs.writeFileSync(vscodeIgnorePath, vscodeIgnore.join("\n"));
  console.log("✅ .vscodeignore updated with production dependencies from both main extension & webview-ui.");
} catch (error) {
  console.error("❌ Error generating .vscodeignore:", error.message);
  process.exit(1);
}
