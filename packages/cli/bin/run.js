#!/usr/bin/env node
import { createRequire } from "node:module";
import { config as loadDotenvConfig } from "dotenv";
import satisfies from "semver/functions/satisfies.js";

const require = createRequire(import.meta.url);
const { engines } = require("../package.json");
if (!satisfies(process.versions.node, engines.node)) {
  console.error(
    `[browse] Node.js ${engines.node} is required; found ${process.versions.node}. Upgrade Node.js and rerun browse.`,
  );
  process.exit(1);
}

// `BROWSE_LOAD_DOTENV` controls whether `browse` auto-loads a `.env` file
// from the current working directory. This is deprecated: a future release
// will flip the default to "off" so `browse` only reads `process.env`,
// matching how most CLIs used across many unrelated projects behave. Until
// then we keep loading `.env` by default (unset behaves exactly as before)
// but warn once when we actually pull a value from it, so users relying on
// the implicit default get a heads-up before the default changes.
const dotenvToggle = process.env.BROWSE_LOAD_DOTENV;
const dotenvOptedOut =
  dotenvToggle !== undefined && ["0", "false", "no"].includes(dotenvToggle.toLowerCase());

if (!dotenvOptedOut) {
  const keysBeforeLoad = new Set(Object.keys(process.env));
  const { parsed } = loadDotenvConfig();
  const appliedFromDotenv = Object.keys(parsed ?? {}).filter((key) => !keysBeforeLoad.has(key));

  if (appliedFromDotenv.length > 0 && dotenvToggle === undefined) {
    console.error(
      `[browse] Loaded ${appliedFromDotenv.join(", ")} from .env. Auto-loading .env is deprecated and will be disabled by default in a future release -- export these variables in your shell instead, or set BROWSE_LOAD_DOTENV=1 to keep this behavior explicitly once that happens. Set BROWSE_LOAD_DOTENV=0 to opt out today. Run \`browse doctor\` to check for conflicts with your shell environment.`,
    );
  }
}

globalThis.oclif = {
  ...globalThis.oclif,
  enableAutoTranspile: false,
};

// Temporary, opt-in instrumentation for the CI startup diagnostic.
const traceStartup = process.env.BROWSE_STARTUP_TRACE === "1";
const beforeOclifMs = traceStartup ? process.uptime() * 1000 : 0;
const importStart = traceStartup ? performance.now() : 0;
const { execute, settings } = await import("@oclif/core");
const importEnd = traceStartup ? performance.now() : 0;
if (traceStartup) settings.performanceEnabled = true;
try {
  await execute({ dir: import.meta.url });
} finally {
  if (traceStartup) {
    // execute includes the finally hook, which oclif's own report excludes.
    console.error(
      "[browse-startup] " +
        JSON.stringify({
          beforeOclifMs,
          oclifImportMs: importEnd - importStart,
          executeMs: performance.now() - importEnd,
          processUptimeMs: process.uptime() * 1000,
        }),
    );
  }
}
