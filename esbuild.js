const esbuild = require("esbuild");
const { nodeExternalsPlugin } = require("esbuild-node-externals");
const { execSync } = require("child_process");
const path = require("path");

// Function to build the webview UI
function buildWebview() {
  console.log("🔨 Building webview-ui...");
  const webviewPath = path.join(__dirname, "webview-ui");
  try {
    execSync("npm install && npm run build", { cwd: webviewPath, stdio: "inherit" });
    console.log("✅ Webview UI built successfully!");
  } catch (error) {
    console.error("❌ Webview UI build failed:", error.message);
    process.exit(1);
  }
}

// Build the extension
async function buildExtension() {
  try {
    await esbuild.build({
      entryPoints: ["./src/extension.ts"], // Your main extension entry file
      bundle: true,
      minify: true,
      sourcemap: false,
      platform: "node",
      external: ["vscode"], // Exclude the vscode module
      outfile: "out/extension.js",
      plugins: [nodeExternalsPlugin()], // Exclude node_modules from bundling
    });
    console.log("✅ Extension bundled successfully!");
  } catch (error) {
    console.error("❌ Extension bundling failed:", error.message);
    process.exit(1);
  }
}

// Run both builds
buildWebview();
buildExtension();
