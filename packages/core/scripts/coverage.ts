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
import { spawn, type ChildProcess } from "node:child_process";
import { findRepoRoot } from "./test-utils";
import normalizeV8Coverage from "./normalize-v8-coverage";

const repoRoot = findRepoRoot(process.cwd());
const command = process.argv[2];
const terminationSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
const log = (message: string) => console.log(`[coverage:merge] ${message}`);

let activeChild: ChildProcess | null = null;
let isCancelling = false;

const exitCodeForSignal = (signal: NodeJS.Signals): number =>
  signal === "SIGINT" ? 130 : 143;

const handleTermination = (signal: NodeJS.Signals) => {
  isCancelling = true;
  log(`received ${signal}, exiting`);
  if (activeChild && activeChild.pid && !activeChild.killed) {
    activeChild.kill(signal);
  }
  process.exit(exitCodeForSignal(signal));
};

terminationSignals.forEach((signal) => {
  process.once(signal, () => handleTermination(signal));
});

const assertNotCancelling = () => {
  if (isCancelling) {
    throw new Error("Coverage merge cancelled");
  }
};

if (!command || command !== "merge") {
  console.error("Usage: coverage merge");
  process.exit(1);
}

const coverageDir = path.join(repoRoot, "coverage");
const outDir = path.join(repoRoot, "coverage", "merged");
const v8TempDir = path.join(coverageDir, ".v8-tmp");
if (!process.env.V8_COVERAGE_SCAN_LIMIT) {
  process.env.V8_COVERAGE_SCAN_LIMIT = "2000";
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.rmSync(v8TempDir, { recursive: true, force: true });
log(`normalizing v8 coverage in ${coverageDir}`);
log(`using V8_COVERAGE_SCAN_LIMIT=${process.env.V8_COVERAGE_SCAN_LIMIT}`);
const normalizeStart = Date.now();
await normalizeV8Coverage(coverageDir);
log(`normalize completed in ${Date.now() - normalizeStart}ms`);
const collectV8CoverageFiles = (dir: string): string[] => {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (current: string) => {
    assertNotCancelling();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      assertNotCancelling();
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
log(`found ${v8CoverageFiles.length} v8 coverage files`);

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(v8TempDir, { recursive: true, force: true });
fs.mkdirSync(v8TempDir, { recursive: true });
v8CoverageFiles.forEach((file, index) => {
  assertNotCancelling();
  const dest = path.join(v8TempDir, `coverage-${index}.json`);
  fs.copyFileSync(file, dest);
});
log(`copied files to ${v8TempDir}`);

const runC8Report = async () => {
  assertNotCancelling();
  log("running c8 report merge");
  const args = [
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
  ];
  let stdout = "";

  const status = await new Promise<number>((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(String(chunk));
    });

    child.once("error", (error) => {
      activeChild = null;
      reject(error);
    });
    child.once("close", (code) => {
      activeChild = null;
      resolve(code ?? 1);
    });
  });

  if (stdout) {
    fs.writeFileSync(path.join(outDir, "coverage-summary.txt"), stdout);
  }
  log(`c8 report completed with status ${status}`);
  return status;
};

try {
  const status = await runC8Report();
  process.exit(status);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!isCancelling) {
    console.error(`Failed to run c8 coverage report: ${message}`);
  }
  process.exit(1);
}
