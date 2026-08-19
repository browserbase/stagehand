// Runs an eve CLI command with STAGEHAND_EXTENSION_* env vars pointing at the
// real installed SDK assets. Eve's bundlers (nitro for build, the dev-runtime
// authored-module compiler) inline @browserbasehq/stagehand and re-anchor
// import.meta.url, so the SDK's derived asset paths break inside the bundle.
// This script resolves the paths OUTSIDE any bundle and forwards them.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkEntry = fileURLToPath(import.meta.resolve("@browserbasehq/stagehand"));
const sdkDist = path.dirname(sdkEntry);

const child = spawn("eve", process.argv.slice(2), {
  stdio: "inherit",
  // The eve bin is a .cmd shim on Windows, which Node refuses to spawn
  // without a shell.
  shell: process.platform === "win32",
  env: {
    ...process.env,
    STAGEHAND_EXTENSION_ARCHIVE_PATH: path.join(sdkDist, "assets/stagehand-extension.zip"),
    STAGEHAND_EXTENSION_DIRECTORY_PATH: path.join(sdkDist, "extension/"),
  },
});
child.on("error", (error) => {
  // oxlint-disable-next-line no-console -- CLI wrapper reports launch failures to stderr.
  console.error(
    `Failed to launch the eve CLI (${error.message}). Run pnpm install first, or invoke this script through a pnpm script so node_modules/.bin is on PATH.`,
  );
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
