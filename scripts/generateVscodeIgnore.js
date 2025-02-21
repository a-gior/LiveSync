const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const vscodeIgnorePath = ".vscodeignore";
const webviewPath = path.join(process.cwd(), "webview-ui"); // Full path to webview-ui
const startMarker = "#### Include only production dependencies ####\r";
const endMarker = "##############################################";

try {
  // Function to get production dependencies and return correctly formatted relative paths
  function getProdDependencies(dir) {
    try {
      return execSync("npm list --omit=dev --parseable --depth=9999", { cwd: dir })
        .toString()
        .trim()
        .split("\n")
        .map((line) => {
          let relativePath = path.relative(process.cwd(), line).replace(/\\/g, "/");
          console.log(`📦 ${relativePath}`);
          
          return `!${relativePath}`;
        })
        .filter(Boolean); // Remove any null values
    } catch (error) {
      console.warn(`⚠️ Warning: Failed to fetch dependencies from ${dir}`);
      return [];
    }
  }

  // Get production dependencies from both locations
  let mainDeps = getProdDependencies(process.cwd()); 
  let webviewDeps = getProdDependencies(webviewPath);

  // Remove first entry (root project path) from both
  mainDeps.shift();
  webviewDeps.shift();

  // Read the existing .vscodeignore file
  let vscodeIgnore = fs.readFileSync(vscodeIgnorePath, "utf8").split("\n");

  // Find start and end markers
  const startIndex = vscodeIgnore.indexOf(startMarker);
  const endIndex = vscodeIgnore.indexOf(endMarker, startIndex + 1);

  if (startIndex !== -1 && endIndex !== -1) {
    // Keep content outside markers & insert dependencies in between
    vscodeIgnore = [
      ...vscodeIgnore.slice(0, startIndex + 1),
      "# 📌 Main Extension Dependencies",
      ...mainDeps,
      "# 📌 Webview UI Dependencies",
      ...webviewDeps,
      ...vscodeIgnore.slice(endIndex)
    ];
  } else {
    console.error("❌ Error: Could not find dependency markers in .vscodeignore");
    process.exit(1);
  }

  // Write updated .vscodeignore
  fs.writeFileSync(vscodeIgnorePath, vscodeIgnore.join("\n"));

  console.log("✅ .vscodeignore updated with production dependencies from both main extension & webview-ui.");
} catch (error) {
  console.error("❌ Error generating .vscodeignore:", error.message);
  process.exit(1);
}
