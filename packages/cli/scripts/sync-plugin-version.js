#!/usr/bin/env node

// Keeps every plugin manifest and the bundled skill pinned to the browse CLI's
// package.json version. Run from packages/cli (e.g. via `pnpm sync-plugin-version`).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  readFileSync(resolve(cliRoot, "package.json"), "utf8"),
);

function syncSkillVersion(label, path) {
  const content = readFileSync(path, "utf8");
  const updated = content.replace(/^version:\s*.+$/m, `version: ${version}`);
  if (updated !== content) {
    writeFileSync(path, updated);
    console.log(`Updated ${label} version to ${version}`);
  } else {
    console.log(`${label} version already at ${version}`);
  }
}

function syncPluginJsonVersion(label, path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  if (json.version !== version) {
    json.version = version;
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`Updated ${label} version to ${version}`);
  } else {
    console.log(`${label} version already at ${version}`);
  }
}

syncSkillVersion("skills/browse/SKILL.md", resolve(cliRoot, "skills/browse/SKILL.md"));

for (const marketplace of [
  ".claude-plugin",
  ".codex-plugin",
  ".cursor-plugin",
  ".grok-plugin",
]) {
  syncPluginJsonVersion(
    `plugins/browse/${marketplace}/plugin.json`,
    resolve(cliRoot, "plugins/browse", marketplace, "plugin.json"),
  );
}
