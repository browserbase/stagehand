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
import normalizeV8Coverage from "./normalize-v8-coverage";

const repoRoot = findRepoRoot(process.cwd());
const command = process.argv[2];

if (!command || command !== "merge") {
  console.error("Usage: coverage merge");
  process.exit(1);
}

const coverageDir = path.join(repoRoot, "coverage");
const outDir = path.join(repoRoot, "coverage", "merged");
fs.rmSync(outDir, { recursive: true, force: true });
await normalizeV8Coverage(coverageDir);
const collectV8CoverageFiles = (dir: string): string[] => {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (current: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".v8-tmp" || entry.name === "merged") {
          continue;
        }
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        if (!raw.trim()) continue;
        const parsed = JSON.parse(raw) as { result?: unknown };
        if (parsed?.result) results.push(fullPath);
      } catch {
        // ignore invalid JSON in coverage dir
      }
    }
  };
  walk(dir);
  return results;
};

const v8CoverageFiles = collectV8CoverageFiles(coverageDir);
if (v8CoverageFiles.length === 0) {
  console.log("No V8 coverage files found.");
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const v8TempDir = path.join(coverageDir, ".v8-tmp");
fs.rmSync(v8TempDir, { recursive: true, force: true });
fs.mkdirSync(v8TempDir, { recursive: true });
v8CoverageFiles.forEach((file, index) => {
  const dest = path.join(v8TempDir, `coverage-${index}.json`);
  fs.copyFileSync(file, dest);
});

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "c8",
    "report",
    "--temp-directory",
    v8TempDir,
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
