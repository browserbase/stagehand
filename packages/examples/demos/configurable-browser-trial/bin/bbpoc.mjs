#!/usr/bin/env node
// Thin launcher so `bbpoc ...` runs the TypeScript CLI via tsx with no build step.
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "src", "cli.ts");

// Resolve tsx from THIS package's node_modules so the launcher works from any cwd.
const require = createRequire(import.meta.url);
let tsxImport = "tsx";
try {
  tsxImport = pathToFileURL(require.resolve("tsx")).href;
} catch {
  /* fall back to bare specifier; resolves when run inside the installed repo */
}

const child = spawn(process.execPath, ["--import", tsxImport, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("Failed to launch bbpoc:", err.message);
  console.error("Did you run `npm install`?");
  process.exit(1);
});
