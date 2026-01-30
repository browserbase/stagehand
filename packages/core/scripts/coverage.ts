/**
 * Coverage merge (V8 -> Istanbul).
 *
 * Prereqs: V8 coverage JSON files in `coverage/**` (from test scripts).
 * Args: `merge` only.
 * Env: none required.
 * Example: pnpm run coverage:merge
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findRepoRoot } from "./test-utils";

const repoRoot = findRepoRoot(process.cwd());
const command = process.argv[2];

if (!command || command !== "merge") {
  console.error("Usage: coverage merge");
  process.exit(1);
}

const coverageDir = path.join(repoRoot, "coverage");
const outDir = path.join(repoRoot, "coverage", "merged");
fs.rmSync(outDir, { recursive: true, force: true });
const hasCoverageFiles = (dir: string): boolean => {
  if (!fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasCoverageFiles(fullPath)) return true;
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      return true;
    }
  }
  return false;
};

if (!hasCoverageFiles(coverageDir)) {
  console.log("No V8 coverage files found.");
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "c8",
    "report",
    "--temp-directory",
    coverageDir,
    "--merge-async",
    "--reporter=html",
    "--reporter=lcov",
    "--reporter=json",
    "--reporter=text-summary",
    "--reports-dir",
    outDir,
    "--cwd",
    repoRoot,
    "--include",
    "packages/**",
    "--exclude",
    "**/node_modules/**",
    "--exclude",
    "**/dist/**",
    "--exclude",
    "**/examples/**",
    "--exclude",
    "**/scripts/**",
    "--exclude",
    "packages/**/test/**",
    "--exclude",
    "packages/**/tests/**",
    "--exclude",
    "packages/**/examples/**",
    "--exclude",
    "packages/**/lib/**/tests/**",
    "--exclude",
    "packages/**/scripts/**",
    "--exclude-after-remap",
    "--exclude",
    "**/*.d.ts",
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);

if (result.stdout) {
  process.stdout.write(result.stdout);
  fs.writeFileSync(path.join(outDir, "coverage-summary.txt"), result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
process.exit(result.status ?? 1);
