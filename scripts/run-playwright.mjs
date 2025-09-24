import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

// Pass-through runner that executes the compiled Playwright config.
// We intentionally avoid tsx/ts-node to sidestep worker loader timing issues.

const args = process.argv.slice(2);
const cliArgs = args[0] === "test" ? args : ["test", ...args];
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

const result = spawnSync(process.execPath, [playwrightCli, ...cliArgs], {
  stdio: "inherit",
  env: { ...process.env },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
